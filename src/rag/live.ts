import { getDb } from "@/db/client";
import { formatIdrShort } from "@/analytics/bandar";
import type { FeedStatus, MarketAlert, Quote } from "@/market/types";

/** Live documents are rewritten in place, so they never get embeddings (see embedMissing). */
export const LIVE_KIND = "live";

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")}%`;
}

/**
 * Keeps the RAG index in step with the capture: one document for the market as a whole
 * and one per watchlist stock, all stamped with the IDX record time so an answer can
 * say how old the figures are.
 */
export function upsertLiveDocs(status: FeedStatus, quotes: readonly Quote[], alerts: readonly MarketAlert[]) {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO docs (kind, ref, title, body, source_url, created_at)
     VALUES (?, ?, ?, ?, 'https://www.idx.co.id', ?)
     ON CONFLICT(kind, ref) DO UPDATE SET title = excluded.title, body = excluded.body, created_at = excluded.created_at`
  );
  const stamp = status.idxDataTime ? `Data IDX per ${status.idxDataTime.replace("T", " ")} WIB` : "Waktu data IDX tidak diketahui";

  const movers = (rows: typeof status.gainers) => rows.map((m) => `${m.code} ${pct(m.changePct)} (Rp ${m.price.toLocaleString("id-ID")})`).join(", ") || "-";
  const market = [
    `${stamp}. Pasar ${status.marketOpen ? "sedang buka" : "tutup"}.`,
    status.ihsg ? `IHSG ${status.ihsg.price.toLocaleString("id-ID", { maximumFractionDigits: 2 })} (${pct(status.ihsg.changePct)}).` : "IHSG belum tersedia.",
    `Naik terbesar: ${movers(status.gainers)}.`,
    `Turun terbesar: ${movers(status.losers)}.`,
    `Alert terbaru: ${alerts.map((a) => `${a.title} (${a.ts.slice(11, 16)} UTC)`).join("; ") || "belum ada"}.`,
  ].join("\n");

  db.exec("BEGIN IMMEDIATE");
  try {
    upsert.run(LIVE_KIND, "live:market", "Kondisi pasar saham sekarang (IHSG, penggerak, alert)", market, nowIso);
    for (const q of quotes) {
      const body = [
        `${stamp}.`,
        `Harga ${q.code}: Rp ${q.price.toLocaleString("id-ID")} (${pct(q.changePct)} dari penutupan sebelumnya).`,
        `Buka ${q.open ?? "-"}, tertinggi ${q.high ?? "-"}, terendah ${q.low ?? "-"}.`,
        `Volume ${q.volume?.toLocaleString("id-ID") ?? "-"} lembar, nilai ${q.valueTraded ? formatIdrShort(q.valueTraded) : "-"}.`,
        q.relVolume === null ? "" : `Volume hari ini ${q.relVolume.toFixed(2).replace(".", ",")}x rata-rata 10 sesi.`,
      ]
        .filter(Boolean)
        .join("\n");
      upsert.run(LIVE_KIND, `live:${q.code}`, `Harga live ${q.code}`, body, nowIso);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
