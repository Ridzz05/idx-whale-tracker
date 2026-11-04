import { chromium, type Browser } from "playwright-core";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getEnv, resolveChromePath } from "@/lib/env";
import { createLlmClient } from "@/agent/llm";
import { nativeSearch } from "./search";
import { fetchPage, type FetchMode } from "./fetch";

export interface SwarmFinding {
  query: string;
  url: string;
  title: string;
  via: "native" | "headless";
  summary: string;
}

export interface SwarmFailed {
  query: string;
  reason: string;
}

export interface SwarmResult {
  findings: SwarmFinding[];
  failed: SwarmFailed[];
}

const SubQueriesSchema = z.object({
  queries: z.array(z.string().min(2)).min(1),
});

function heuristicSubQueries(question: string, maxWorkers: number): string[] {
  const base = question.trim();
  const candidates = [
    base,
    `${base} berita terbaru IDX Indonesia`,
    `${base} analisis pasar saham BEI`,
    `${base} data KSEI OJK`,
    `${base} laporan keuangan emiten`,
  ];
  return candidates.slice(0, maxWorkers);
}

async function planSubQueries(question: string, maxWorkers: number): Promise<string[]> {
  const env = getEnv();
  if (!env.LLM_API_KEY || !env.LLM_MODEL) {
    return heuristicSubQueries(question, maxWorkers);
  }
  try {
    const client = createLlmClient();
    const resp = await client.chat.completions.create({
      model: env.LLM_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            'Pecah pertanyaan pengguna menjadi sub-query pencarian web yang berbeda dan spesifik. Balas HANYA JSON valid dengan bentuk {"queries": ["...", "..."]}.',
        },
        {
          role: "user",
          content: `Pertanyaan: "${question}"\nMaksimal sub-query: ${maxWorkers}`,
        },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "";
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (jsonMatch) {
      const parsed = SubQueriesSchema.safeParse(JSON.parse(jsonMatch[0]));
      if (parsed.success) {
        return parsed.data.queries.slice(0, maxWorkers);
      }
    }
  } catch {
    // Fallback to deterministic sub-queries if LLM planning fails
  }
  return heuristicSubQueries(question, maxWorkers);
}

async function summarizePage(
  subQuery: string,
  url: string,
  title: string,
  text: string
): Promise<string> {
  const env = getEnv();
  const clipped = text.slice(0, 4000);
  if (!env.LLM_API_KEY || !env.LLM_MODEL) {
    const excerpt = clipped.slice(0, 500);
    return `${title}: ${excerpt} (Sumber: ${url})`;
  }
  try {
    const client = createLlmClient();
    const resp = await client.chat.completions.create({
      model: env.LLM_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "Rangkum isi halaman web berikut untuk menjawab sub-query dalam bahasa Indonesia, maksimal 150 kata, dan WAJIB menyertakan URL sumber secara eksplisit.",
        },
        {
          role: "user",
          content: `Sub-query: ${subQuery}\nJudul: ${title}\nURL: ${url}\nIsi:\n${clipped}`,
        },
      ],
    });
    const content = resp.choices[0]?.message?.content?.trim();
    if (content) {
      return content.includes(url) ? content : `${content}\nSumber: ${url}`;
    }
  } catch {
    // Fallback to extractive summary
  }
  return `${title}: ${clipped.slice(0, 500)} (Sumber: ${url})`;
}

export async function runSwarm(
  opts: {
    question: string;
    maxWorkers?: number;
    mode?: FetchMode;
  },
  _ctx?: unknown
): Promise<SwarmResult> {
  const maxWorkers = Math.max(1, Math.min(5, opts.maxWorkers ?? 3));
  const mode: FetchMode = opts.mode ?? "auto";
  const question = opts.question.trim();

  let sharedBrowser: Browser | undefined;
  const getSharedBrowser = async (): Promise<Browser> => {
    if (!sharedBrowser) {
      sharedBrowser = await chromium.launch({
        executablePath: resolveChromePath(),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
    }
    return sharedBrowser;
  };

  const findings: SwarmFinding[] = [];
  const failed: SwarmFailed[] = [];

  const runWork = async () => {
    const subQueries = await planSubQueries(question, maxWorkers);

    const workerPromises = subQueries.map(async (q) => {
      const hits = await nativeSearch(q, 5);
      const top2 = hits.slice(0, 2);
      if (top2.length === 0) {
        throw new Error("search_empty");
      }
      const workerFindings: SwarmFinding[] = [];
      let lastErr = "no_page_fetched";
      for (const hit of top2) {
        try {
          const browser = mode === "native" ? undefined : await getSharedBrowser();
          const page = await fetchPage(hit.url, mode, browser);
          if (!page.text || page.text.length < 40) {
            lastErr = "empty_page_text";
            continue;
          }
          const summary = await summarizePage(q, page.url, page.title || hit.title, page.text);
          workerFindings.push({
            query: q,
            url: page.url,
            title: page.title || hit.title,
            via: page.via,
            summary,
          });
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }
      if (workerFindings.length === 0) {
        throw new Error(lastErr);
      }
      return { q, workerFindings };
    });

    const settled = await Promise.allSettled(workerPromises);
    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      const q = subQueries[i];
      if (s.status === "fulfilled") {
        findings.push(...s.value.workerFindings);
      } else {
        failed.push({
          query: q,
          reason: s.reason instanceof Error ? s.reason.message : String(s.reason),
        });
      }
    }
  };

  const timeoutPromise = Promise.withResolvers<"timeout">();
  const timer = setTimeout(() => timeoutPromise.resolve("timeout"), 60000);

  try {
    const outcome = await Promise.race([
      runWork().then(() => "done" as const),
      timeoutPromise.promise,
    ]);
    if (outcome === "timeout" && findings.length === 0 && failed.length === 0) {
      failed.push({ query: question, reason: "swarm_timeout_60s" });
    }
  } finally {
    clearTimeout(timer);
    if (sharedBrowser) {
      await sharedBrowser.close().catch(() => {});
    }
  }

  if (findings.length > 0) {
    const db = getDb();
    const nowIso = new Date().toISOString();
    const upsertWebDoc = db.prepare(`
      INSERT INTO docs (kind, ref, title, body, source_url, created_at)
      VALUES ('web', ?, ?, ?, ?, ?)
      ON CONFLICT(kind, ref) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        source_url = excluded.source_url,
        created_at = excluded.created_at
    `);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const f of findings) {
        upsertWebDoc.run(f.url, f.title, f.summary, f.url, nowIso);
      }
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }
  }

  return { findings, failed };
}
