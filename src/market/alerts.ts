import { formatIdrShort } from "@/analytics/bandar";
import type { Mover, NewAlert, Quote } from "./types";

/** Stocks trading less than this per day are ignored; their moves are mostly noise. */
export const LIQUID_VALUE_IDR = 5_000_000_000;
export const STOCK_MOVE_TIERS = [5, 10] as const;
export const INDEX_MOVE_TIERS = [1, 2] as const;
export const VOLUME_TIERS = [3, 5] as const;
export const ALERT_COOLDOWN_MS = 30 * 60_000;

function tierOf(value: number, tiers: readonly number[]): number {
  return tiers.filter((t) => value >= t).length;
}

function pct(n: number, digits = 2): string {
  return n.toFixed(digits).replace(".", ",");
}

function idr(n: number): string {
  return `Rp ${n.toLocaleString("id-ID")}`;
}

const SEVERITY_RANK = { high: 2, warn: 1, info: 0 } as const;

/**
 * Compares two consecutive snapshots and returns alerts for thresholds crossed
 * since `prev`. A stock absent from `prev` never alerts, so the first snapshot
 * after a restart cannot fire a burst. Keys carry the tier so an escalation
 * (5% to 10%) is not swallowed by the cooldown of the lower tier.
 */
export function detectAlerts(
  prev: ReadonlyMap<string, Quote>,
  quotes: readonly Quote[],
  ihsg: Quote | null
): NewAlert[] {
  const out: NewAlert[] = [];

  const prevIhsg = prev.get("IHSG");
  if (ihsg && prevIhsg) {
    const tier = tierOf(Math.abs(ihsg.changePct), INDEX_MOVE_TIERS);
    if (tier > tierOf(Math.abs(prevIhsg.changePct), INDEX_MOVE_TIERS)) {
      const up = ihsg.changePct > 0;
      out.push({
        key: `IHSG|index_move|${up ? "up" : "down"}|${tier}`,
        code: "IHSG",
        kind: "index_move",
        severity: tier === INDEX_MOVE_TIERS.length ? "high" : "warn",
        title: `IHSG ${up ? "naik" : "turun"} ${pct(Math.abs(ihsg.changePct))}%`,
        detail: `Level ${ihsg.price.toLocaleString("id-ID", { maximumFractionDigits: 2 })}, melewati ambang ${INDEX_MOVE_TIERS[tier - 1]}%`,
        price: ihsg.price,
        changePct: ihsg.changePct,
      });
    }
  }

  for (const q of quotes) {
    const p = prev.get(q.code);
    const traded = q.valueTraded ?? 0;
    if (!p || traded < LIQUID_VALUE_IDR) continue;
    const context = `Harga ${idr(q.price)}, nilai transaksi ${formatIdrShort(traded)}`;

    const moveTier = tierOf(Math.abs(q.changePct), STOCK_MOVE_TIERS);
    if (moveTier > tierOf(Math.abs(p.changePct), STOCK_MOVE_TIERS)) {
      const up = q.changePct > 0;
      out.push({
        key: `${q.code}|price_move|${up ? "up" : "down"}|${moveTier}`,
        code: q.code,
        kind: "price_move",
        severity: moveTier === STOCK_MOVE_TIERS.length ? "high" : "warn",
        title: `${q.code} ${up ? "naik" : "turun"} ${pct(Math.abs(q.changePct))}%`,
        detail: `${context}, melewati ambang ${STOCK_MOVE_TIERS[moveTier - 1]}%`,
        price: q.price,
        changePct: q.changePct,
      });
    }

    if (q.relVolume !== null) {
      const volTier = tierOf(q.relVolume, VOLUME_TIERS);
      if (volTier > tierOf(p.relVolume ?? 0, VOLUME_TIERS)) {
        out.push({
          key: `${q.code}|volume_spike|${volTier}`,
          code: q.code,
          kind: "volume_spike",
          severity: volTier === VOLUME_TIERS.length ? "high" : "warn",
          title: `${q.code} volume ${pct(q.relVolume, 1)}x rata-rata 10 sesi`,
          detail: context,
          price: q.price,
          changePct: q.changePct,
        });
      }
    }
  }

  return out.sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.code.localeCompare(b.code)
  );
}

/**
 * Drops alerts whose key fired within `cooldownMs`. Only accepted alerts
 * record a timestamp, so a suppressed alert never extends its own cooldown.
 */
export function applyCooldown(
  alerts: readonly NewAlert[],
  lastFired: Map<string, number>,
  nowMs: number,
  cooldownMs = ALERT_COOLDOWN_MS
): NewAlert[] {
  const accepted: NewAlert[] = [];
  for (const alert of alerts) {
    const last = lastFired.get(alert.key);
    if (last !== undefined && nowMs - last < cooldownMs) continue;
    lastFired.set(alert.key, nowMs);
    accepted.push(alert);
  }
  return accepted;
}

/** Top movers among liquid stocks, so a 20% jump in a Rp 50 juta stock never tops the list. */
export function topMovers(quotes: readonly Quote[], n = 5): { gainers: Mover[]; losers: Mover[] } {
  const liquid: Mover[] = quotes
    .filter((q) => (q.valueTraded ?? 0) >= LIQUID_VALUE_IDR)
    .map((q) => ({ code: q.code, price: q.price, changePct: q.changePct, valueTraded: q.valueTraded ?? 0 }));
  const gainers = liquid.filter((m) => m.changePct > 0).sort((a, b) => b.changePct - a.changePct);
  const losers = liquid.filter((m) => m.changePct < 0).sort((a, b) => a.changePct - b.changePct);
  return { gainers: gainers.slice(0, n), losers: losers.slice(0, n) };
}
