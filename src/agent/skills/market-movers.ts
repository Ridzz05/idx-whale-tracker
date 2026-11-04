import { z } from "zod";
import { ensureFeed } from "@/market/feed";

export const schema = z.object({
  code: z
    .string()
    .min(4)
    .max(6)
    .optional()
    .describe("Kode saham untuk satu kuotasi live. Kosongkan untuk ringkasan pasar."),
  alert_limit: z.number().int().min(1).max(30).optional().describe("Jumlah alert terbaru (default 10)"),
});

export const marketMoversSkill = {
  name: "market_movers",
  description:
    "Data pasar yang ditangkap langsung dari situs IDX lewat browser relay: IHSG, saham naik dan turun terbesar, alert terbaru, atau kuotasi satu saham. Selalu sebutkan idx_data_time pada jawaban.",
  schema,
  async run(args: z.infer<typeof schema>) {
    const feed = ensureFeed();
    const status = feed.status();
    if (status.fetchedAt === null) {
      return {
        error:
          status.state === "error"
            ? `Capture IDX gagal: ${status.error ?? "tanpa keterangan"}`
            : "Capture IDX belum menerima data pertama. Coba lagi beberapa detik lagi.",
      };
    }
    const base = {
      captured_at: new Date(status.fetchedAt).toISOString(),
      idx_data_time_wib: status.idxDataTime,
      lag_seconds: status.lagSeconds,
      market_open: status.marketOpen,
      feed_state: status.state,
      watchlist_size: status.watchlistSize,
      note: "Watchlist hanya memuat saham dengan nilai transaksi terbesar pada hari bursa terakhir. Saham lain tidak dipantau live.",
    };

    if (args.code) {
      const q = feed.quote(args.code);
      if (!q) return { error: `Saham ${args.code.toUpperCase()} tidak ada di watchlist live`, ...base };
      return {
        ...base,
        quote: {
          code: q.code,
          price: q.price,
          change_pct: q.changePct,
          open: q.open,
          high: q.high,
          low: q.low,
          volume: q.volume,
          value_traded_idr: q.valueTraded,
          relative_volume_10d: q.relVolume,
          idx_record_time_wib: q.idxTime,
        },
      };
    }

    return {
      ...base,
      ihsg: status.ihsg,
      gainers: status.gainers,
      losers: status.losers,
      recent_alerts: feed.recentAlerts(args.alert_limit ?? 10),
    };
  },
};
