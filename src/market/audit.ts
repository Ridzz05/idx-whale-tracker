import { z } from "zod";
import { getDb } from "@/db/client";

/** Rows kept per log table; the oldest are pruned on every write. */
const KEEP = 4000;

export interface ApiLogEntry {
  endpoint: string;
  ok: boolean;
  status?: number | null;
  durationMs: number;
  rows?: number | null;
  message?: string | null;
}

export interface CaptureLogEntry {
  state: "ok" | "error";
  watchlist?: number | null;
  quotes?: number | null;
  lagSeconds?: number | null;
  durationMs?: number | null;
  message?: string | null;
}

/**
 * Both writers run inside the capture loop, so a broken log must never stop a capture:
 * the failure is reported to stderr and swallowed.
 */
export function logApi(entry: ApiLogEntry) {
  try {
    const db = getDb();
    const res = db
      .prepare(
        `INSERT INTO api_log (ts, endpoint, ok, status, duration_ms, rows, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.endpoint,
        entry.ok ? 1 : 0,
        entry.status ?? null,
        entry.durationMs,
        entry.rows ?? null,
        entry.message ?? null
      );
    db.prepare(`DELETE FROM api_log WHERE id <= ?`).run(Number(res.lastInsertRowid) - KEEP);
  } catch (err) {
    console.error("[api-log] gagal menulis", entry.endpoint, err);
  }
}

export function logCapture(entry: CaptureLogEntry) {
  try {
    const db = getDb();
    const res = db
      .prepare(
        `INSERT INTO capture_log (ts, state, watchlist, quotes, lag_seconds, duration_ms, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.state,
        entry.watchlist ?? null,
        entry.quotes ?? null,
        entry.lagSeconds ?? null,
        entry.durationMs ?? null,
        entry.message ?? null
      );
    db.prepare(`DELETE FROM capture_log WHERE id <= ?`).run(Number(res.lastInsertRowid) - KEEP);
  } catch (err) {
    console.error("[capture-log] gagal menulis", err);
  }
}

const EndpointHealthSchema = z.object({
  endpoint: z.string(),
  requests: z.number(),
  ok: z.number(),
  errors: z.number(),
  p50_ms: z.number(),
  p95_ms: z.number(),
  last_ts: z.string(),
  last_error: z.string().nullable(),
});

export type EndpointHealth = z.infer<typeof EndpointHealthSchema>;

export interface ApiHealth {
  windowHours: number;
  requests: number;
  errors: number;
  okPct: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  lastOkTs: string | null;
  lastErrorTs: string | null;
  endpoints: EndpointHealth[];
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

/** Aggregates the sampled API calls; the window is measured back from now. */
export function apiHealth(windowHours = 24): ApiHealth {
  const db = getDb();
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const durations = db
    .prepare(`SELECT endpoint, duration_ms FROM api_log WHERE ts >= ? ORDER BY duration_ms ASC`)
    .all(since) as { endpoint: string; duration_ms: number }[];
  const grouped = db
    .prepare(
      `SELECT endpoint,
              COUNT(*) AS requests,
              SUM(ok) AS ok,
              SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors,
              MAX(ts) AS last_ts,
              (SELECT message FROM api_log e WHERE e.endpoint = a.endpoint AND e.ok = 0 ORDER BY e.id DESC LIMIT 1) AS last_error
       FROM api_log a WHERE ts >= ? GROUP BY endpoint ORDER BY requests DESC`
    )
    .all(since);

  const byEndpoint = new Map<string, number[]>();
  for (const d of durations) {
    const arr = byEndpoint.get(d.endpoint) ?? [];
    byEndpoint.set(d.endpoint, arr);
    arr.push(d.duration_ms);
  }
  const all = [...durations.map((d) => d.duration_ms)].sort((a, b) => a - b);

  const endpoints = z
    .array(
      z.object({
        endpoint: z.string(),
        requests: z.number(),
        ok: z.number(),
        errors: z.number(),
        last_ts: z.string(),
        last_error: z.string().nullable(),
      })
    )
    .parse(grouped)
    .map((e) => {
      const own = byEndpoint.get(e.endpoint) ?? [];
      return {
        ...e,
        p50_ms: percentile(own, 0.5),
        p95_ms: percentile(own, 0.95),
      };
    });

  const totals = endpoints.reduce(
    (acc, e) => ({ requests: acc.requests + e.requests, ok: acc.ok + e.ok, errors: acc.errors + e.errors }),
    { requests: 0, ok: 0, errors: 0 }
  );
  const lastOk = db
    .prepare(`SELECT ts FROM api_log WHERE ok = 1 ORDER BY id DESC LIMIT 1`)
    .get() as { ts: string } | undefined;
  const lastError = db
    .prepare(`SELECT ts FROM api_log WHERE ok = 0 ORDER BY id DESC LIMIT 1`)
    .get() as { ts: string } | undefined;

  return {
    windowHours,
    requests: totals.requests,
    errors: totals.errors,
    okPct: totals.requests > 0 ? (totals.ok / totals.requests) * 100 : null,
    p50Ms: all.length > 0 ? percentile(all, 0.5) : null,
    p95Ms: all.length > 0 ? percentile(all, 0.95) : null,
    lastOkTs: lastOk?.ts ?? null,
    lastErrorTs: lastError?.ts ?? null,
    endpoints,
  };
}

const ApiRowSchema = z.object({
  id: z.number(),
  ts: z.string(),
  endpoint: z.string(),
  ok: z.number(),
  status: z.number().nullable(),
  duration_ms: z.number(),
  rows: z.number().nullable(),
  message: z.string().nullable(),
});

export type ApiLogRow = z.infer<typeof ApiRowSchema>;

export function recentApiLog(limit = 60): ApiLogRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, endpoint, ok, status, duration_ms, rows, message
       FROM api_log ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
  return z.array(ApiRowSchema).parse(rows);
}

const CaptureRowSchema = z.object({
  id: z.number(),
  ts: z.string(),
  state: z.string(),
  watchlist: z.number().nullable(),
  quotes: z.number().nullable(),
  lag_seconds: z.number().nullable(),
  duration_ms: z.number().nullable(),
  message: z.string().nullable(),
});

export type CaptureLogRow = z.infer<typeof CaptureRowSchema>;

export function recentCaptureLog(limit = 60): CaptureLogRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, state, watchlist, quotes, lag_seconds, duration_ms, message
       FROM capture_log ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
  return z.array(CaptureRowSchema).parse(rows);
}

export interface JobLogEntry {
  job: string;
  state: "ok" | "error";
  durationMs: number;
  summary?: unknown;
  message?: string | null;
}

/**
 * CLI jobs (sync, scan, index) write one row when they finish. A failing write must never
 * turn a finished job into a failed one, so the error only reaches stderr.
 */
export function logJob(entry: JobLogEntry) {
  try {
    const db = getDb();
    const res = db
      .prepare(
        `INSERT INTO job_log (ts, job, state, duration_ms, summary, message)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.job,
        entry.state,
        entry.durationMs,
        entry.summary === undefined ? null : JSON.stringify(entry.summary),
        entry.message ?? null
      );
    db.prepare(`DELETE FROM job_log WHERE id <= ?`).run(Number(res.lastInsertRowid) - KEEP);
  } catch (err) {
    console.error("[job-log] gagal menulis", entry.job, err);
  }
}

/** Wraps a CLI job so its outcome is recorded whatever it returns or throws. */
export async function runLoggedJob<T>(job: string, fn: () => Promise<T> | T): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    logJob({ job, state: "ok", durationMs: Date.now() - t0, summary: result });
    return result;
  } catch (err) {
    logJob({
      job,
      state: "error",
      durationMs: Date.now() - t0,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

const JobRowSchema = z.object({
  id: z.number(),
  ts: z.string(),
  job: z.string(),
  state: z.string(),
  duration_ms: z.number(),
  summary: z.string().nullable(),
  message: z.string().nullable(),
});

export type JobLogRow = z.infer<typeof JobRowSchema>;

export function recentJobLog(limit = 40): JobLogRow[] {
  const rows = getDb()
    .prepare(`SELECT id, ts, job, state, duration_ms, summary, message FROM job_log ORDER BY id DESC LIMIT ?`)
    .all(limit);
  return z.array(JobRowSchema).parse(rows);
}
