import { z } from "zod";

export const AlertKindSchema = z.enum(["price_move", "volume_spike", "index_move"]);
export const AlertSeveritySchema = z.enum(["info", "warn", "high"]);

export const MarketAlertSchema = z.object({
  id: z.number(),
  ts: z.string(),
  code: z.string(),
  kind: AlertKindSchema,
  severity: AlertSeveritySchema,
  title: z.string(),
  detail: z.string(),
  price: z.number().nullable(),
  changePct: z.number().nullable(),
});

export const MoverSchema = z.object({
  code: z.string(),
  price: z.number(),
  changePct: z.number(),
  valueTraded: z.number(),
});

export const FeedStatusSchema = z.object({
  state: z.enum(["connecting", "ok", "error"]),
  fetchedAt: z.number().nullable(),
  marketOpen: z.boolean(),
  moving: z.boolean().nullable(),
  ihsg: z.object({ price: z.number(), changePct: z.number(), idxTime: z.string().nullable() }).nullable(),
  /** Index update time published by IDX, as "YYYY-MM-DDTHH:MM:SS" in WIB. */
  idxDataTime: z.string().nullable(),
  /** Seconds between the capture and idxDataTime. */
  lagSeconds: z.number().nullable(),
  watchlistSize: z.number(),
  gainers: z.array(MoverSchema),
  losers: z.array(MoverSchema),
  error: z.string().nullable(),
});

export const FeedEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), status: FeedStatusSchema, alerts: z.array(MarketAlertSchema) }),
  z.object({ type: z.literal("status"), status: FeedStatusSchema }),
  z.object({ type: z.literal("alert"), alert: MarketAlertSchema }),
]);

export type AlertKind = z.infer<typeof AlertKindSchema>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export type MarketAlert = z.infer<typeof MarketAlertSchema>;
export type Mover = z.infer<typeof MoverSchema>;
export type FeedStatus = z.infer<typeof FeedStatusSchema>;
export type FeedEvent = z.infer<typeof FeedEventSchema>;

/** `key` identifies an alert for cooldown dedupe and is never persisted. */
export type NewAlert = Omit<MarketAlert, "id" | "ts"> & { key: string };

export interface Quote {
  code: string;
  price: number;
  changePct: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  valueTraded: number | null;
  /** Today's volume over the average daily volume of the last 10 stored sessions. */
  relVolume: number | null;
  /** IDX record creation time, WIB, as published. */
  idxTime: string | null;
}
