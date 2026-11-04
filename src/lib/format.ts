/** Formats a percent value (not a ratio) with a direction arrow so the sign never relies on color alone. */
export function signedPct(pct: number, digits = 2): string {
  const body = Math.abs(pct).toFixed(digits).replace(".", ",");
  if (pct > 0) return `▲ +${body}%`;
  if (pct < 0) return `▼ -${body}%`;
  return `${body}%`;
}
