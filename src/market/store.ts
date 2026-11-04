import { z } from "zod";
import { getDb } from "@/db/client";
import { AlertKindSchema, AlertSeveritySchema, type MarketAlert, type NewAlert, type Quote } from "./types";

const KEEP_ALERTS = 500;
const KEEP_HISTORY_DAYS = 7;

const AlertRowSchema = z.object({
  id: z.number(),
  ts: z.string(),
  code: z.string(),
  kind: AlertKindSchema,
  severity: AlertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  price: z.number().nullable(),
  change_pct: z.number().nullable(),
});

const AvgRowSchema = z.object({ code: z.string(), avg: z.number() });

export function saveAlert(alert: NewAlert, nowIso = new Date().toISOString()): MarketAlert {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO market_alerts (ts, code, kind, severity, title, detail, price, change_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(nowIso, alert.code, alert.kind, alert.severity, alert.title, alert.detail, alert.price, alert.changePct);
  const id = Number(res.lastInsertRowid);
  db.prepare(`DELETE FROM market_alerts WHERE id <= ?`).run(id - KEEP_ALERTS);
  return {
    id,
    ts: nowIso,
    code: alert.code,
    kind: alert.kind,
    severity: alert.severity,
    title: alert.title,
    detail: alert.detail,
    price: alert.price,
    changePct: alert.changePct,
  };
}

export function recentAlerts(limit = 30): MarketAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT id, ts, code, kind, severity, title, detail, price, change_pct
       FROM market_alerts ORDER BY id DESC LIMIT ?`
    )
    .all(limit);
  return z.array(AlertRowSchema).parse(rows).map(({ change_pct, ...rest }) => ({ ...rest, changePct: change_pct }));
}

/** Average daily volume over the 10 stored sessions before `beforeDate`, per stock. */
export function loadAvgVolume(beforeDate: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT code, AVG(volume) AS avg FROM (
         SELECT code, volume, ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) AS rn
         FROM prices WHERE date < ? AND code != 'IHSG' AND volume > 0
       ) WHERE rn <= 10 GROUP BY code`
    )
    .all(beforeDate);
  return new Map(z.array(AvgRowSchema).parse(rows).map((r) => [r.code, r.avg]));
}

/**
 * Stores the latest capture. History rows are keyed by IDX's DTCreate, which follows the
 * request time, so every successful poll adds one row per stock; rows older than a week are pruned.
 */
export function saveCapture(quotes: readonly Quote[], ihsg: Quote | null, capturedAtIso: string) {
  const db = getDb();
  const upsertQuote = db.prepare(
    `INSERT INTO idx_quotes (code, price, prev_close, change_pct, open, high, low, volume, value, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET price = excluded.price, prev_close = excluded.prev_close,
       change_pct = excluded.change_pct, open = excluded.open, high = excluded.high, low = excluded.low,
       volume = excluded.volume, value = excluded.value, captured_at = excluded.captured_at`
  );
  const addHistory = db.prepare(
    `INSERT OR IGNORE INTO idx_quote_history (code, ts, price, volume, value) VALUES (?, ?, ?, ?, ?)`
  );
  const upsertIndex = db.prepare(
    `INSERT INTO idx_index_quotes (index_code, current, change_pct, idx_time, captured_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(index_code) DO UPDATE SET current = excluded.current, change_pct = excluded.change_pct,
       idx_time = excluded.idx_time, captured_at = excluded.captured_at`
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const q of quotes) {
      const prevClose = q.price / (1 + q.changePct / 100);
      upsertQuote.run(q.code, q.price, prevClose, q.changePct, q.open, q.high, q.low, q.volume, q.valueTraded, capturedAtIso);
      if (q.idxTime) addHistory.run(q.code, q.idxTime, q.price, q.volume, q.valueTraded);
    }
    if (ihsg) upsertIndex.run("COMPOSITE", ihsg.price, ihsg.changePct, ihsg.idxTime, capturedAtIso);
    const cutoff = new Date(Date.parse(capturedAtIso) - KEEP_HISTORY_DAYS * 86_400_000 + 7 * 3_600_000)
      .toISOString()
      .slice(0, 19);
    db.prepare(`DELETE FROM idx_quote_history WHERE ts < ?`).run(cutoff);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
