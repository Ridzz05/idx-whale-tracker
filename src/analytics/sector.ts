export interface StockSeriesRow {
  code: string;
  name?: string;
  sector: string | null;
  closes: { date: string; close: number }[];
}

export interface SectorRotationRow {
  sector: string;
  stockCount: number;
  ret5d: number | null;
  ret21d: number | null;
  ret63d: number | null;
  rel21d: number | null;
  topStocks: { code: string; ret21d: number }[];
}

function windowReturn(closes: { date: string; close: number }[], n: number): number | null {
  if (closes.length < n + 1) return null;
  const last = closes[closes.length - 1].close;
  const prev = closes[closes.length - 1 - n].close;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null;
  return last / prev - 1;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  let s = 0;
  for (const v of vals) s += v;
  return s / vals.length;
}

export function computeSectorRotation(
  stocks: StockSeriesRow[],
  ihsgCloses: { date: string; close: number }[]
): {
  ihsg: { ret5d: number | null; ret21d: number | null; ret63d: number | null };
  sectors: SectorRotationRow[];
} {
  const sortedIhsg = [...ihsgCloses].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const ihsg = {
    ret5d: windowReturn(sortedIhsg, 5),
    ret21d: windowReturn(sortedIhsg, 21),
    ret63d: windowReturn(sortedIhsg, 63),
  };

  const bySector = new Map<
    string,
    {
      count: number;
      r5: number[];
      r21: number[];
      r63: number[];
      members21: { code: string; ret21d: number }[];
    }
  >();

  for (const st of stocks) {
    if (!st.sector || !st.sector.trim()) continue;
    if (st.code === "IHSG") continue;
    const sec = st.sector.trim();
    let bucket = bySector.get(sec);
    if (!bucket) {
      bucket = { count: 0, r5: [], r21: [], r63: [], members21: [] };
      bySector.set(sec, bucket);
    }
    bucket.count += 1;
    const sorted = [...st.closes].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0
    );
    const v5 = windowReturn(sorted, 5);
    const v21 = windowReturn(sorted, 21);
    const v63 = windowReturn(sorted, 63);
    if (v5 !== null) bucket.r5.push(v5);
    if (v21 !== null) {
      bucket.r21.push(v21);
      bucket.members21.push({ code: st.code, ret21d: v21 });
    }
    if (v63 !== null) bucket.r63.push(v63);
  }

  const sectors: SectorRotationRow[] = [];
  for (const [sector, b] of bySector.entries()) {
    const ret5d = mean(b.r5);
    const ret21d = mean(b.r21);
    const ret63d = mean(b.r63);
    const rel21d =
      ret21d !== null && ihsg.ret21d !== null ? ret21d - ihsg.ret21d : null;
    const topStocks = [...b.members21]
      .sort((a, b2) => b2.ret21d - a.ret21d)
      .slice(0, 5);
    sectors.push({
      sector,
      stockCount: b.count,
      ret5d,
      ret21d,
      ret63d,
      rel21d,
      topStocks,
    });
  }

  sectors.sort((a, b) => {
    const av = a.ret21d ?? -Infinity;
    const bv = b.ret21d ?? -Infinity;
    if (bv !== av) return bv - av;
    return a.sector.localeCompare(b.sector);
  });

  return { ihsg, sectors };
}
