import { z } from "zod";
import { getEnv } from "@/lib/env";
import { logApi } from "@/market/audit";

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayError";
  }
}

const VersionSchema = z.object({ webSocketDebuggerUrl: z.string() });
const MessageSchema = z.object({
  id: z.number().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
const TargetsSchema = z.object({
  targetInfos: z.array(z.object({ targetId: z.string(), type: z.string(), url: z.string() })),
});
const AttachSchema = z.object({ sessionId: z.string() });
const EvalSchema = z.object({
  result: z.object({ value: z.unknown().optional() }),
  exceptionDetails: z
    .object({
      text: z.string(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
});

const MAX_TAB_ATTEMPTS = 3;
/** How long a Cloudflare-challenged tab is skipped before it is tried again. */
const BAD_TAB_TTL_MS = 5 * 60_000;

/** Zod schemas return arrays for list endpoints and objects for the per-ticker chunk. */
function countRows(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows)) {
    return (value as { rows: unknown[] }).rows.length;
  }
  return null;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

declare global {
  var __whaleRelay: { url: string; client: RelayClient } | undefined;
}

/**
 * The relay exposes the user's whole Chrome profile. This is the only gate that keeps
 * the app on the IDX site, so it is strict: https and the exact host www.idx.co.id,
 * which is also the origin the /primary API paths resolve against.
 */
export function isIdxUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.idx.co.id";
  } catch {
    return false;
  }
}

/**
 * Talks to OMP Browser Relay over raw CDP. Playwright's connectOverCDP cannot attach
 * to the relay (it asserts on the target list), so this speaks the protocol directly.
 */
export class RelayClient {
  #ws: WebSocket | null = null;
  #opening: Promise<WebSocket> | null = null;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #session: { id: string; target: string } | null = null;
  readonly #bad = new Map<string, number>();
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async evaluate<S extends z.ZodType>(
    expression: string,
    schema: S,
    timeoutMs = 45_000,
    endpoint = "IDX"
  ): Promise<z.infer<S>> {
    const t0 = Date.now();
    try {
      const value = await this.#evaluate(expression, schema, timeoutMs);
      logApi({
        endpoint,
        ok: true,
        status: 200,
        durationMs: Date.now() - t0,
        rows: countRows(value),
      });
      return value;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const http = /HTTP (\d{3})/.exec(message);
      logApi({
        endpoint,
        ok: false,
        status: http ? Number(http[1]) : null,
        durationMs: Date.now() - t0,
        message,
      });
      throw err;
    }
  }

  async #evaluate<S extends z.ZodType>(expression: string, schema: S, timeoutMs: number): Promise<z.infer<S>> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.#ensureSession();
      try {
        const raw = await this.#send(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          session.id,
          timeoutMs
        );
        const parsed = EvalSchema.parse(raw);
        if (parsed.exceptionDetails) {
          const d = parsed.exceptionDetails;
          throw new RelayError(`Skrip di halaman IDX gagal: ${d.exception?.description ?? d.text}`);
        }
        return schema.parse(parsed.result.value);
      } catch (err) {
        if (!(err instanceof RelayError) || attempt >= MAX_TAB_ATTEMPTS - 1) throw err;
        if (/HTTP 403/.test(err.message)) {
          // Cloudflare challenged this tab; another IDX tab may still hold a cleared session.
          this.#bad.set(session.target, Date.now());
          this.#session = null;
          continue;
        }
        if (/session|target/i.test(err.message)) {
          this.#session = null;
          continue;
        }
        throw err;
      }
    }
  }

  close() {
    this.#ws?.close();
  }

  /** Marks the tab in use as challenged by Cloudflare so the next attempt picks another IDX tab. */
  quarantineSession() {
    if (this.#session) this.#bad.set(this.#session.target, Date.now());
    this.#session = null;
  }

  async #ensureSession(): Promise<{ id: string; target: string }> {
    if (this.#session) return this.#session;
    const targets = TargetsSchema.parse(await this.#send("Target.getTargets", {}));
    const idxPages = targets.targetInfos.filter((t) => t.type === "page" && isIdxUrl(t.url));
    if (idxPages.length === 0) {
      throw new RelayError("Tidak ada tab www.idx.co.id yang terbuka di Chrome. Buka https://www.idx.co.id lalu coba lagi.");
    }
    const now = Date.now();
    for (const [id, at] of this.#bad) if (now - at > BAD_TAB_TTL_MS) this.#bad.delete(id);
    const page = idxPages.find((t) => !this.#bad.has(t.targetId));
    if (!page) {
      throw new RelayError(
        "Cloudflare meminta verifikasi di semua tab idx.co.id. Buka salah satu tab IDX di Chrome, selesaikan verifikasinya, lalu biarkan tab itu terbuka."
      );
    }
    const { sessionId } = AttachSchema.parse(
      await this.#send("Target.attachToTarget", { targetId: page.targetId, flatten: true })
    );
    this.#session = { id: sessionId, target: page.targetId };
    return this.#session;
  }

  async #open(): Promise<WebSocket> {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) return this.#ws;
    this.#opening ??= this.#connect().finally(() => {
      this.#opening = null;
    });
    return this.#opening;
  }

  async #connect(): Promise<WebSocket> {
    let wsUrl: string;
    try {
      const res = await fetch(`${this.#baseUrl}/json/version`, { signal: AbortSignal.timeout(5000) });
      wsUrl = VersionSchema.parse(await res.json()).webSocketDebuggerUrl;
    } catch {
      throw new RelayError(
        `OMP Browser Relay tidak terjangkau di ${this.#baseUrl}. Pastikan relay aktif dan ekstensinya terpasang di Chrome.`
      );
    }
    if (new URL(wsUrl).hostname !== new URL(this.#baseUrl).hostname) {
      throw new RelayError("Relay mengiklankan host WebSocket yang berbeda dari RELAY_URL; koneksi ditolak.");
    }

    const ws = new WebSocket(wsUrl);
    const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new RelayError("Koneksi WebSocket ke relay gagal."));
    ws.onmessage = (e) => this.#onMessage(String(e.data));
    ws.onclose = () => {
      this.#ws = null;
      this.#session = null;
      this.#failAll(new RelayError("Koneksi ke relay terputus."));
    };
    this.#ws = await promise;
    return ws;
  }

  #onMessage(raw: string) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const msg = MessageSchema.safeParse(json);
    if (!msg.success || msg.data.id === undefined) return;
    const pending = this.#pending.get(msg.data.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(msg.data.id);
    if (msg.data.error) pending.reject(new RelayError(msg.data.error.message));
    else pending.resolve(msg.data.result ?? {});
  }

  #failAll(error: Error) {
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.#pending.clear();
  }

  async #send(method: string, params: object, sessionId?: string, timeoutMs = 15_000): Promise<unknown> {
    const ws = await this.#open();
    const id = ++this.#nextId;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new RelayError(`Relay tidak menjawab dalam ${timeoutMs / 1000} detik (${method}).`));
    }, timeoutMs);
    this.#pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return promise;
  }
}

/** One client per relay URL, shared across Next module reloads. */
export function getRelay(): RelayClient {
  const url = getEnv().RELAY_URL;
  if (!globalThis.__whaleRelay || globalThis.__whaleRelay.url !== url) {
    globalThis.__whaleRelay?.client.close();
    globalThis.__whaleRelay = { url, client: new RelayClient(url) };
  }
  return globalThis.__whaleRelay.client;
}

/**
 * Closes the socket so a CLI script can exit: the open WebSocket keeps the Node event
 * loop alive even after the work is done.
 */
export function closeRelay() {
  globalThis.__whaleRelay?.client.close();
  globalThis.__whaleRelay = undefined;
}
