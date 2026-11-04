import { getDb } from "./client";
import { computeSectorRotation, type SectorRotationRow, type StockSeriesRow } from "@/analytics/sector";

export interface StockSummaryRow {
  code: string;
  name: string;
  sector: string | null;
  industry: string | null;
  last_price: number | null;
  change_1d: number | null;
  top_holder_name: string | null;
  top_holder_pct: number | null;
  concentration_pct: number;
  holder_count: number;
}

export interface StockDetail {
  code: string;
  name: string;
  sector: string | null;
  industry: string | null;
  last_price: number | null;
  profile_updated_at: string | null;
  change_1d: number | null;
  concentration_pct: number;
  foreign_pct: number;
  holder_count: number;
  period: string | null;
}

export interface HolderRow {
  investor_id: number;
  investor_name: string;
  type: string;
  local_foreign: "L" | "F";
  shares_scripless: number;
  shares_scrip: number;
  total_shares: number;
  pct: number;
  value_idr: number | null;
}

export interface InvestorListItem {
  id: number;
  key: string;
  name: string;
  type: string;
  local_foreign: "L" | "F";
  stocks_held: number;
}

export interface InvestorHoldingRow {
  code: string;
  issuer_name: string;
  sector: string | null;
  last_price: number | null;
  shares_scripless: number;
  shares_scrip: number;
  total_shares: number;
  pct: number;
  value_idr: number | null;
}

export interface SectorAllocationRow {
  sector: string;
  stock_count: number;
  value_idr: number;
  weight_pct: number;
}

export interface BandarScanRow {
  scan_date: string;
  code: string;
  name: string;
  sector: string | null;
  last_price: number | null;
  score: number;
  signal: "accumulation" | "distribution";
  net_flow_7d: number;
  cmf20: number;
  vol_ratio: number;
  explanation: string;
}

export function latestPeriod(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT MAX(period) AS period FROM holdings").get() as
    | { period: string | null }
    | undefined;
  return row?.period ?? null;
}

export function listInvestors(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
}): { items: InvestorListItem[]; total: number; page: number; pageSize: number; period: string | null } {
  const db = getDb();
  const period = latestPeriod();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (opts.q ?? "").trim();

  if (!period) {
    return { items: [], total: 0, page, pageSize, period: null };
  }

  const whereSql = q ? "WHERE UPPER(i.name) LIKE '%' || UPPER(?) || '%'" : "";
  const countParams: (string | number)[] = q ? [q] : [];
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM investors i ${whereSql}`)
    .get(...countParams) as { cnt: number };

  const sql = `
    SELECT
      i.id,
      i.key,
      i.name,
      i.type,
      i.local_foreign,
      COUNT(DISTINCT h.code) AS stocks_held
    FROM investors i
    LEFT JOIN holdings h ON h.investor_id = i.id AND h.period = ?
    ${whereSql}
    GROUP BY i.id
    ORDER BY i.name ASC
    LIMIT ? OFFSET ?
  `;
  const params: (string | number)[] = q ? [period, q, pageSize, offset] : [period, pageSize, offset];
  const items = db.prepare(sql).all(...params) as unknown as InvestorListItem[];

  return { items, total: totalRow.cnt, page, pageSize, period };
}

export function getInvestor(id: number): (InvestorListItem & { period: string | null }) | null {
  const db = getDb();
  const period = latestPeriod();
  const row = db
    .prepare(
      `SELECT i.id, i.key, i.name, i.type, i.local_foreign,
              (SELECT COUNT(DISTINCT h.code) FROM holdings h WHERE h.investor_id = i.id AND h.period = ?) AS stocks_held
       FROM investors i WHERE i.id = ?`
    )
    .get(period ?? "", id) as unknown as InvestorListItem | undefined;
  if (!row) return null;
  return { ...row, period };
}

export function findInvestorsByNameOrId(nameOrId: string): InvestorListItem[] {
  const db = getDb();
  const period = latestPeriod() ?? "";
  const trimmed = nameOrId.trim();
  if (/^\d+$/.test(trimmed)) {
    const one = getInvestor(Number(trimmed));
    return one ? [one] : [];
  }
  const key = trimmed.toUpperCase().replace(/\s+/g, " ");
  const exact = db
    .prepare(
      `SELECT i.id, i.key, i.name, i.type, i.local_foreign,
              (SELECT COUNT(DISTINCT h.code) FROM holdings h WHERE h.investor_id = i.id AND h.period = ?) AS stocks_held
       FROM investors i WHERE i.key = ?`
    )
    .get(period, key) as unknown as InvestorListItem | undefined;
  if (exact) return [exact];

  return db
    .prepare(
      `SELECT i.id, i.key, i.name, i.type, i.local_foreign,
              (SELECT COUNT(DISTINCT h.code) FROM holdings h WHERE h.investor_id = i.id AND h.period = ?) AS stocks_held
       FROM investors i
       WHERE UPPER(i.name) LIKE '%' || UPPER(?) || '%'
       ORDER BY stocks_held DESC, i.name ASC
       LIMIT 5`
    )
    .all(period, trimmed) as unknown as InvestorListItem[];
}

export function investorHoldings(id: number, period?: string | null): InvestorHoldingRow[] {
  const db = getDb();
  const p = period ?? latestPeriod();
  if (!p) return [];
  const rows = db
    .prepare(
      `SELECT
        h.code,
        s.name AS issuer_name,
        s.sector,
        s.last_price,
        h.shares_scripless,
        h.shares_scrip,
        h.total_shares,
        h.pct,
        CASE WHEN s.last_price IS NOT NULL THEN h.total_shares * s.last_price ELSE NULL END AS value_idr
      FROM holdings h
      JOIN stocks s ON s.code = h.code
      WHERE h.investor_id = ? AND h.period = ?
      ORDER BY COALESCE(value_idr, 0) DESC, h.pct DESC, h.code ASC`
    )
    .all(id, p) as unknown as InvestorHoldingRow[];
  return rows;
}

export function investorSectorAllocation(id: number, period?: string | null): SectorAllocationRow[] {
  const holdings = investorHoldings(id, period);
  const bySec = new Map<string, { count: number; value: number; pctSum: number }>();
  let totalValue = 0;
  let totalPct = 0;
  for (const h of holdings) {
    const sec = h.sector && h.sector.trim() ? h.sector.trim() : "Unclassified";
    const cur = bySec.get(sec) ?? { count: 0, value: 0, pctSum: 0 };
    cur.count += 1;
    const val = h.value_idr ?? 0;
    cur.value += val;
    cur.pctSum += h.pct;
    totalValue += val;
    totalPct += h.pct;
    bySec.set(sec, cur);
  }
  const out: SectorAllocationRow[] = [];
  for (const [sector, b] of bySec.entries()) {
    const weight =
      totalValue > 0
        ? (b.value / totalValue) * 100
        : totalPct > 0
        ? (b.pctSum / totalPct) * 100
        : 0;
    out.push({
      sector,
      stock_count: b.count,
      value_idr: b.value,
      weight_pct: weight,
    });
  }
  out.sort((a, b) => b.weight_pct - a.weight_pct);
  return out;
}

export function listStocks(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
}): { items: StockSummaryRow[]; total: number; page: number; pageSize: number; period: string | null } {
  const db = getDb();
  const period = latestPeriod();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.max(1, Math.min(200, opts.pageSize ?? 50));
  const offset = (page - 1) * pageSize;
  const q = (opts.q ?? "").trim();

  const whereSql = q
    ? "WHERE UPPER(s.code) LIKE '%' || UPPER(?) || '%' OR UPPER(s.name) LIKE '%' || UPPER(?) || '%'"
    : "";
  const countParams: string[] = q ? [q, q] : [];
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM stocks s ${whereSql}`)
    .get(...countParams) as { cnt: number };

  const p = period ?? "";
  const sql = `
    SELECT
      s.code,
      s.name,
      s.sector,
      s.industry,
      s.last_price,
      (
        SELECT (p1.close / p2.close - 1.0)
        FROM prices p1
        JOIN prices p2 ON p2.code = s.code
        WHERE p1.code = s.code
          AND p1.date = (SELECT MAX(date) FROM prices WHERE code = s.code)
          AND p2.date = (
            SELECT MAX(date) FROM prices
            WHERE code = s.code AND date < (SELECT MAX(date) FROM prices WHERE code = s.code)
          )
          AND p2.close > 0
      ) AS change_1d,
      (
        SELECT i.name
        FROM holdings h2
        JOIN investors i ON i.id = h2.investor_id
        WHERE h2.code = s.code AND h2.period = ?
        ORDER BY h2.pct DESC
        LIMIT 1
      ) AS top_holder_name,
      (
        SELECT h2.pct
        FROM holdings h2
        WHERE h2.code = s.code AND h2.period = ?
        ORDER BY h2.pct DESC
        LIMIT 1
      ) AS top_holder_pct,
      COALESCE((SELECT SUM(h3.pct) FROM holdings h3 WHERE h3.code = s.code AND h3.period = ?), 0) AS concentration_pct,
      COALESCE((SELECT COUNT(*) FROM holdings h4 WHERE h4.code = s.code AND h4.period = ?), 0) AS holder_count
    FROM stocks s
    ${whereSql}
    ORDER BY s.code ASC
    LIMIT ? OFFSET ?
  `;
  const params: (string | number)[] = q
    ? [p, p, p, p, q, q, pageSize, offset]
    : [p, p, p, p, pageSize, offset];
  const items = db.prepare(sql).all(...params) as unknown as StockSummaryRow[];

  return { items, total: totalRow.cnt, page, pageSize, period };
}

export function getStock(code: string): StockDetail | null {
  const db = getDb();
  const upper = code.trim().toUpperCase();
  const period = latestPeriod();
  const p = period ?? "";
  const s = db
    .prepare(
      `SELECT code, name, sector, industry, last_price, profile_updated_at FROM stocks WHERE code = ?`
    )
    .get(upper) as
    | {
        code: string;
        name: string;
        sector: string | null;
        industry: string | null;
        last_price: number | null;
        profile_updated_at: string | null;
      }
    | undefined;
  if (!s) return null;

  const agg = db
    .prepare(
      `SELECT
        COALESCE(SUM(h.pct), 0) AS concentration_pct,
        COALESCE(SUM(CASE WHEN i.local_foreign = 'F' THEN h.pct ELSE 0 END), 0) AS foreign_pct,
        COUNT(*) AS holder_count
      FROM holdings h
      JOIN investors i ON i.id = h.investor_id
      WHERE h.code = ? AND h.period = ?`
    )
    .get(upper, p) as {
    concentration_pct: number;
    foreign_pct: number;
    holder_count: number;
  };

  const recentPrices = db
    .prepare(`SELECT close FROM prices WHERE code = ? ORDER BY date DESC LIMIT 2`)
    .all(upper) as { close: number }[];
  const change_1d =
    recentPrices.length === 2 && recentPrices[1].close > 0
      ? recentPrices[0].close / recentPrices[1].close - 1
      : null;

  return {
    ...s,
    change_1d,
    concentration_pct: agg.concentration_pct,
    foreign_pct: agg.foreign_pct,
    holder_count: agg.holder_count,
    period,
  };
}

export function stockHolders(code: string, period?: string | null): HolderRow[] {
  const db = getDb();
  const upper = code.trim().toUpperCase();
  const p = period ?? latestPeriod();
  if (!p) return [];
  return db
    .prepare(
      `SELECT
        i.id AS investor_id,
        i.name AS investor_name,
        i.type,
        i.local_foreign,
        h.shares_scripless,
        h.shares_scrip,
        h.total_shares,
        h.pct,
        CASE WHEN s.last_price IS NOT NULL THEN h.total_shares * s.last_price ELSE NULL END AS value_idr
      FROM holdings h
      JOIN investors i ON i.id = h.investor_id
      JOIN stocks s ON s.code = h.code
      WHERE h.code = ? AND h.period = ?
      ORDER BY h.pct DESC, h.total_shares DESC`
    )
    .all(upper, p) as unknown as HolderRow[];
}

export function stockPriceSeries(
  code: string
): { date: string; open: number; high: number; low: number; close: number; volume: number }[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT date, open, high, low, close, volume FROM prices WHERE code = ? ORDER BY date ASC`
    )
    .all(code.trim().toUpperCase()) as unknown as {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}

export function latestBandarScan(opts?: {
  signal?: "accumulation" | "distribution";
  limit?: number;
}): { scanDate: string | null; items: BandarScanRow[] } {
  const db = getDb();
  const dateRow = db
    .prepare(`SELECT MAX(scan_date) AS scan_date FROM bandar_scans`)
    .get() as { scan_date: string | null } | undefined;
  const scanDate = dateRow?.scan_date ?? null;
  if (!scanDate) return { scanDate: null, items: [] };

  const sig = opts?.signal;
  const limit = opts?.limit ?? 200;
  const orderSql = sig === "distribution" ? "ORDER BY b.score ASC, b.net_flow_7d ASC" : "ORDER BY b.score DESC, b.net_flow_7d DESC";
  const whereSig = sig ? "AND b.signal = ?" : "";
  const params: (string | number)[] = sig ? [scanDate, sig, limit] : [scanDate, limit];

  const items = db
    .prepare(
      `SELECT
        b.scan_date,
        b.code,
        s.name,
        s.sector,
        s.last_price,
        b.score,
        b.signal,
        b.net_flow_7d,
        b.cmf20,
        b.vol_ratio,
        b.explanation
      FROM bandar_scans b
      JOIN stocks s ON s.code = b.code
      WHERE b.scan_date = ? ${whereSig}
      ${orderSql}
      LIMIT ?`
    )
    .all(...params) as unknown as BandarScanRow[];

  return { scanDate, items };
}

export function sectorRotation(): {
  ihsg: { ret5d: number | null; ret21d: number | null; ret63d: number | null };
  sectors: SectorRotationRow[];
} {
  const db = getDb();
  const stockMeta = db
    .prepare(`SELECT code, name, sector FROM stocks WHERE sector IS NOT NULL AND TRIM(sector) != ''`)
    .all() as { code: string; name: string; sector: string }[];

  const allPriceRows = db
    .prepare(`SELECT code, date, close FROM prices WHERE close IS NOT NULL ORDER BY code, date ASC`)
    .all() as { code: string; date: string; close: number }[];

  const closesByCode = new Map<string, { date: string; close: number }[]>();
  for (const r of allPriceRows) {
    let arr = closesByCode.get(r.code);
    if (!arr) {
      arr = [];
      closesByCode.set(r.code, arr);
    }
    arr.push({ date: r.date, close: r.close });
  }

  const series: StockSeriesRow[] = stockMeta.map((s) => ({
    code: s.code,
    name: s.name,
    sector: s.sector,
    closes: closesByCode.get(s.code) ?? [],
  }));

  const ihsgCloses = closesByCode.get("IHSG") ?? [];
  return computeSectorRotation(series, ihsgCloses);
}

export interface OverviewStats {
  period: string | null;
  stockCount: number;
  investorCount: number;
  holdingCount: number;
  sectorCount: number;
  pricedStockCount: number;
  lastPriceDate: string | null;
  bandarScanDate: string | null;
  accumulationCount: number;
  distributionCount: number;
}

export function overviewStats(): OverviewStats {
  const db = getDb();
  const period = latestPeriod();
  const count = (sql: string, ...params: (string | null)[]): number => {
    const row = db.prepare(sql).get(...params) as { n: number };
    return row.n;
  };
  const scan = db.prepare(`SELECT MAX(scan_date) AS d FROM bandar_scans`).get() as { d: string | null };
  const lastPrice = db.prepare(`SELECT MAX(date) AS d FROM prices WHERE code != 'IHSG'`).get() as {
    d: string | null;
  };

  return {
    period,
    stockCount: count(`SELECT COUNT(*) AS n FROM stocks`),
    investorCount: count(`SELECT COUNT(*) AS n FROM investors`),
    holdingCount: period ? count(`SELECT COUNT(*) AS n FROM holdings WHERE period = ?`, period) : 0,
    sectorCount: count(`SELECT COUNT(DISTINCT sector) AS n FROM stocks WHERE sector IS NOT NULL AND TRIM(sector) != ''`),
    pricedStockCount: count(`SELECT COUNT(DISTINCT code) AS n FROM prices WHERE code != 'IHSG'`),
    lastPriceDate: lastPrice.d,
    bandarScanDate: scan.d,
    accumulationCount: scan.d
      ? count(`SELECT COUNT(*) AS n FROM bandar_scans WHERE scan_date = ? AND signal = 'accumulation'`, scan.d)
      : 0,
    distributionCount: scan.d
      ? count(`SELECT COUNT(*) AS n FROM bandar_scans WHERE scan_date = ? AND signal = 'distribution'`, scan.d)
      : 0,
  };
}
