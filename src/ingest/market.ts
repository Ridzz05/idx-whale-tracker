import { fetchCompanyProfiles, fetchDayData, fetchTradingCalendar } from "@/capture/idx";
import { getDb } from "@/db/client";

export interface MarketSyncSummary {
  sessions: number;
  datesFetched: number;
  priceRows: number;
  ihsgRows: number;
  stocksUpserted: number;
  failed: { date: string; reason: string }[];
}

/**
 * Backfills daily OHLCV, IHSG and the company directory straight from IDX through the
 * browser relay. One request per trading date returns every listed stock, so a whole
 * session of the market costs two requests per day instead of one per ticker.
 */
export async function syncMarket(opts?: { sessions?: number }): Promise<MarketSyncSummary> {
  const sessions = Math.max(10, Math.min(250, opts?.sessions ?? 125));
  const dates = await fetchTradingCalendar(sessions);
  if (dates.length === 0) {
    throw new Error("Kalender bursa kosong. Pastikan tab www.idx.co.id terbuka dan sudah melewati Cloudflare.");
  }

  const failed: { date: string; reason: string }[] = [];
  const days = await fetchDayData(dates, failed);
  const usable = days.filter((d) => d.stocks.length > 0);

  if (usable.length === 0) {
    // Nothing would replace the existing rows, so deleting them would destroy the only copy.
    throw new Error(
      `IDX tidak mengembalikan data untuk satu tanggal pun; tidak ada yang diubah. Alasan: ${
        failed[0]?.reason ?? "tidak diketahui"
      }`
    );
  }

  if (failed.length > 0) {
    // The table is replaced as a whole, so a partial fetch would silently shrink the history.
    throw new Error(
      `Backfill dibatalkan agar riwayat tidak terpotong: ${failed.length} tanggal gagal (${failed
        .slice(0, 5)
        .map((f) => f.date)
        .join(", ")}). Alasan pertama: ${failed[0].reason}. Jalankan ulang saat IDX sudah tidak membatasi.`
    );
  }

  const profiles = await fetchCompanyProfiles();
  const db = getDb();

  const upsertStock = db.prepare(
    `INSERT INTO stocks (code, name, sector, industry, profile_updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name,
       sector = COALESCE(excluded.sector, stocks.sector),
       industry = COALESCE(excluded.industry, stocks.industry),
       profile_updated_at = excluded.profile_updated_at`
  );
  const upsertPrice = db.prepare(
    `INSERT INTO prices (code, date, open, high, low, close, volume)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code, date) DO UPDATE SET open = excluded.open, high = excluded.high,
       low = excluded.low, close = excluded.close, volume = excluded.volume`
  );
  const setLastPrice = db.prepare(`UPDATE stocks SET last_price = ? WHERE code = ?`);
  const setSector = db.prepare(`UPDATE stocks SET sector = ?, industry = ? WHERE code = ?`);

  const nowIso = new Date().toISOString();
  let priceRows = 0;
  let ihsgRows = 0;
  let stocksUpserted = 0;
  const latestClose = new Map<string, number>();
  const sectorByCode = new Map(profiles.map((p) => [p.code, p]));

  db.exec("BEGIN IMMEDIATE");
  try {
    // Older rows came from another provider; the whole table is replaced so every row is IDX.
    db.prepare(`DELETE FROM prices`).run();

    for (const day of usable) {
      for (const s of day.stocks) {
        upsertPrice.run(s.code, day.date, s.open, s.high, s.low, s.close, s.volume);
        priceRows += 1;
        // fetchTradingCalendar returns dates ascending, so the last write is the latest close.
        latestClose.set(s.code, s.close);
      }
      if (day.index) {
        upsertPrice.run("IHSG", day.date, day.index.previous, day.index.high, day.index.low, day.index.close, day.index.volume);
        ihsgRows += 1;
      }
    }

    for (const p of profiles) {
      upsertStock.run(p.code, p.name, p.sector, p.industry, nowIso);
      stocksUpserted += 1;
    }
    // Stocks that the ownership import already created also get IDX's own classification.
    for (const [code, close] of latestClose) {
      setLastPrice.run(close, code);
      const p = sectorByCode.get(code);
      if (p) setSector.run(p.sector, p.industry, code);
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { sessions, datesFetched: days.length, priceRows, ihsgRows, stocksUpserted, failed };
}
