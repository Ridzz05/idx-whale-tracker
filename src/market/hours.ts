export const SESSION_POLL_MS = 60_000;
export const IDLE_POLL_MS = 300_000;

const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** The current date in WIB as YYYY-MM-DD. */
export function wibDate(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Mon-Fri 08:45-16:30 WIB, which brackets the IDX sessions with margin for the
 * pre-opening. Public holidays are not modelled, so the feed polls at the session
 * rate on those days; that costs requests, not correctness.
 */
export function isMarketHours(d: Date): boolean {
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  const day = wib.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = wib.getUTCHours() * 60 + wib.getUTCMinutes();
  return minutes >= 8 * 60 + 45 && minutes <= 16 * 60 + 30;
}

export function intervalFor(d: Date): number {
  return isMarketHours(d) ? SESSION_POLL_MS : IDLE_POLL_MS;
}

/**
 * IDX publishes the index update time as a bare "HH:MM:SS" (WIB). This attaches the date:
 * today, or the previous trading day when the time is still in the future (before the
 * open) or today is a weekend. Public holidays are not modelled. Returns
 * "YYYY-MM-DDTHH:MM:SS" in WIB, or null when the input is not a clock time.
 */
export function indexTimeToWib(time: string | null, nowMs: number): string | null {
  // IDX sends "16:00" today and "16:00:00" on other rows, so seconds are optional.
  const m = /^(\d{2}:\d{2})(?::(\d{2}))?$/.exec(time ?? "");
  if (!m) return null;
  const clock = `${m[1]}:${m[2] ?? "00"}`;
  let ms = Date.parse(`${wibDate(new Date(nowMs))}T${clock}+07:00`);
  if (Number.isNaN(ms)) return null;
  if (ms > nowMs + 60_000) ms -= DAY_MS;
  for (let i = 0; i < 3; i++) {
    const day = new Date(ms + WIB_OFFSET_MS).getUTCDay();
    if (day !== 0 && day !== 6) break;
    ms -= DAY_MS;
  }
  return new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 19);
}
