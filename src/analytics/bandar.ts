export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BandarResult {
  score: number;
  signal: "accumulation" | "distribution" | null;
  net_flow_7d: number;
  cmf20: number;
  vol_ratio: number;
  avg_val_20: number;
  explanation: string;
}

export function formatIdrShort(val: number): string {
  const sign = val < 0 ? "-" : "";
  const abs = Math.abs(val);
  if (abs >= 1e12) {
    return `${sign}Rp ${(abs / 1e12).toFixed(2).replace(".", ",")} T`;
  }
  if (abs >= 1e9) {
    return `${sign}Rp ${(abs / 1e9).toFixed(1).replace(".", ",")} M`;
  }
  if (abs >= 1e6) {
    return `${sign}Rp ${(abs / 1e6).toFixed(1).replace(".", ",")} Jt`;
  }
  return `${sign}Rp ${Math.round(abs).toLocaleString("id-ID")}`;
}

export function scoreStock(candles: Candle[]): BandarResult | null {
  const sorted = [...candles]
    .filter(
      (c) =>
        Number.isFinite(c.close) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.volume) &&
        c.close > 0 &&
        c.volume >= 0
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (sorted.length < 21) return null;

  const last20 = sorted.slice(-20);
  const last7 = sorted.slice(-7);
  const last5 = sorted.slice(-5);

  let sumMfv20 = 0;
  let sumVal20 = 0;
  let sumVol20 = 0;

  for (const c of last20) {
    const mfm =
      c.high === c.low ? 0 : (c.close - c.low - (c.high - c.close)) / (c.high - c.low);
    const val = c.volume * c.close;
    const mfv = mfm * val;
    sumMfv20 += mfv;
    sumVal20 += val;
    sumVol20 += c.volume;
  }

  const avg_val_20 = sumVal20 / 20;
  if (avg_val_20 < 1_000_000_000) {
    return null;
  }

  let net_flow_7d = 0;
  for (const c of last7) {
    const mfm =
      c.high === c.low ? 0 : (c.close - c.low - (c.high - c.close)) / (c.high - c.low);
    net_flow_7d += mfm * c.volume * c.close;
  }

  let sumVol5 = 0;
  for (const c of last5) {
    sumVol5 += c.volume;
  }

  const cmf20 = sumVal20 > 0 ? sumMfv20 / sumVal20 : 0;
  const avgVol20 = sumVol20 / 20;
  const avgVol5 = sumVol5 / 5;
  const vol_ratio = avgVol20 > 0 ? avgVol5 / avgVol20 : 0;

  const score = Math.round(Math.max(0, Math.min(100, 50 + 100 * cmf20)));

  let signal: "accumulation" | "distribution" | null = null;
  if (score >= 65 && net_flow_7d > 0) {
    signal = "accumulation";
  } else if (score <= 35 && net_flow_7d < 0) {
    signal = "distribution";
  }

  const cmfStr = (cmf20 >= 0 ? "+" : "") + cmf20.toFixed(2).replace(".", ",");
  const ratioStr = vol_ratio.toFixed(2).replace(".", ",");
  const explanation = `CMF20 ${cmfStr}, arus bersih 7 hari ${formatIdrShort(net_flow_7d)} , volume 5 hari ${ratioStr}x rata-rata 20 hari`;

  return {
    score,
    signal,
    net_flow_7d,
    cmf20,
    vol_ratio,
    avg_val_20,
    explanation,
  };
}
