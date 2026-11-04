import { getDb } from "@/db/client";
import { scoreStock, type Candle } from "@/analytics/bandar";

export function runBandarScan(scanDate?: string): {
  scanDate: string;
  scannedStocks: number;
  accumulationCount: number;
  distributionCount: number;
} {
  const db = getDb();
  const today = scanDate ?? new Date().toISOString().slice(0, 10);

  const codes = db
    .prepare(`SELECT code FROM stocks ORDER BY code ASC`)
    .all() as { code: string }[];

  const selectCandles = db.prepare(
    `SELECT date, open, high, low, close, volume FROM prices WHERE code = ? ORDER BY date ASC`
  );

  const deleteToday = db.prepare(`DELETE FROM bandar_scans WHERE scan_date = ?`);
  const insertScan = db.prepare(`
    INSERT INTO bandar_scans (scan_date, code, score, signal, net_flow_7d, cmf20, vol_ratio, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let accumulationCount = 0;
  let distributionCount = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    deleteToday.run(today);
    for (const { code } of codes) {
      const candles = selectCandles.all(code) as unknown as Candle[];
      const res = scoreStock(candles);
      if (!res || !res.signal) continue;
      insertScan.run(
        today,
        code,
        res.score,
        res.signal,
        res.net_flow_7d,
        res.cmf20,
        res.vol_ratio,
        res.explanation
      );
      if (res.signal === "accumulation") accumulationCount += 1;
      else if (res.signal === "distribution") distributionCount += 1;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    scanDate: today,
    scannedStocks: codes.length,
    accumulationCount,
    distributionCount,
  };
}

const isMain =
  process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("scripts/scan-bandar.ts");
if (isMain) {
  const summary = runBandarScan();
  console.log(JSON.stringify(summary, null, 2));
}
