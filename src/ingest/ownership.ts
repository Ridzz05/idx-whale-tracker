import ExcelJS from "exceljs";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/db/client";

export const EXPECTED_HEADER = [
  "DATE",
  "SHARE_CODE",
  "ISSUER_NAME",
  "INVESTOR_NAME",
  "INVESTOR_CLASSIFICATION",
  "LOCAL_FOREIGN",
  "NATIONALITY",
  "DOMICILE",
  "HOLDINGS_SCRIPLESS",
  "HOLDINGS_SCRIP",
  "TOTAL_HOLDING_SHARES",
  "PERCENTAGE",
] as const;

export interface ParsedHoldingRow {
  period: string;
  code: string;
  issuerName: string;
  investorKey: string;
  investorName: string;
  investorType: string;
  localForeign: "L" | "F";
  scripless: number;
  scrip: number;
  totalShares: number;
  pct: number;
}

export interface OwnershipParseResult {
  period: string;
  rows: ParsedHoldingRow[];
  invalidCounts: Record<string, number>;
  headerRow: number;
}

export interface OwnershipImportSummary {
  file: string;
  period: string;
  importedRows: number;
  distinctStocks: number;
  distinctInvestors: number;
  invalidCounts: Record<string, number>;
}

const MONTH_MAP: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

function cellToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val.trim();
  if (typeof val === "number" || typeof val === "boolean") return String(val).trim();
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "object") {
    if ("result" in val && val.result !== undefined && val.result !== null) {
      return cellToString(val.result);
    }
    if ("text" in val && typeof val.text === "string") {
      return val.text.trim();
    }
    if ("richText" in val && Array.isArray(val.richText)) {
      return val.richText
        .map((r: unknown) =>
          r && typeof r === "object" && "text" in r && typeof r.text === "string" ? r.text : ""
        )
        .join("")
        .trim();
    }
  }
  return String(val).trim();
}

function cellToNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (val && typeof val === "object" && "result" in val) {
    return cellToNumber(val.result);
  }
  const s = cellToString(val).replace(/,/g, "");
  if (!s) return NaN;
  return Number(s);
}

export function normalizeDate(val: unknown): string | null {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (val && typeof val === "object" && "result" in val) {
    return normalizeDate(val.result);
  }
  const s = cellToString(val);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/.exec(s);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mon = MONTH_MAP[m[2].toUpperCase()];
    if (mon) return `${m[3]}-${mon}-${dd}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export function normalizeInvestorKey(name: string): string {
  return name.toUpperCase().replace(/\s+/g, " ").trim();
}

export function normalizeInvestorType(raw: string): string {
  const t = raw.trim();
  if (!t) return "Other";
  if (t.toLowerCase() === "corporate") return "Corporation";
  return t;
}

export async function parseOwnershipXlsx(filePath: string): Promise<OwnershipParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) {
    throw new Error("Header DATE/SHARE_CODE tidak ditemukan");
  }

  let headerRow = -1;
  const maxScan = Math.min(50, ws.rowCount);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    const a = cellToString(row.getCell(1).value).toUpperCase();
    const b = cellToString(row.getCell(2).value).toUpperCase();
    if (a === "DATE" && b === "SHARE_CODE") {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) {
    throw new Error("Header DATE/SHARE_CODE tidak ditemukan dalam 50 baris pertama");
  }

  const hRow = ws.getRow(headerRow);
  const actualHeader: string[] = [];
  for (let c = 1; c <= 12; c++) {
    actualHeader.push(cellToString(hRow.getCell(c).value).toUpperCase());
  }

  for (let i = 0; i < 12; i++) {
    if (actualHeader[i] !== EXPECTED_HEADER[i]) {
      throw new Error(
        `Header pada baris ${headerRow} tidak sesuai kontrak. Ditemukan: [${actualHeader.join(", ")}], Diharapkan: [${EXPECTED_HEADER.join(", ")}]`
      );
    }
  }

  const invalidCounts: Record<string, number> = {};
  const bumpInvalid = (reason: string) => {
    invalidCounts[reason] = (invalidCounts[reason] ?? 0) + 1;
  };

  const rows: ParsedHoldingRow[] = [];
  const periodCounts = new Map<string, number>();

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawDate = row.getCell(1).value;
    const rawCode = cellToString(row.getCell(2).value).toUpperCase();
    const rawIssuer = cellToString(row.getCell(3).value);
    const rawInvestor = cellToString(row.getCell(4).value);
    const rawClass = cellToString(row.getCell(5).value);
    const rawLf = cellToString(row.getCell(6).value).toUpperCase();
    const rawDom = cellToString(row.getCell(8).value).toUpperCase();
    const scripless = cellToNumber(row.getCell(9).value);
    const scrip = cellToNumber(row.getCell(10).value);
    const total = cellToNumber(row.getCell(11).value);
    const pct = cellToNumber(row.getCell(12).value);

    if (!rawCode && !rawIssuer && !rawInvestor && !cellToString(rawDate)) {
      continue;
    }

    const period = normalizeDate(rawDate);
    if (!period) {
      bumpInvalid("invalid_date");
      continue;
    }

    if (!/^[A-Z0-9]{4}$/.test(rawCode)) {
      bumpInvalid("invalid_share_code");
      continue;
    }

    if (!rawIssuer) {
      bumpInvalid("missing_issuer_name");
      continue;
    }

    const investorKey = normalizeInvestorKey(rawInvestor);
    if (!investorKey) {
      bumpInvalid("missing_investor_name");
      continue;
    }

    if (
      !Number.isFinite(scripless) ||
      !Number.isFinite(scrip) ||
      !Number.isFinite(total) ||
      scripless < 0 ||
      scrip < 0 ||
      Math.round(scripless + scrip) !== Math.round(total)
    ) {
      bumpInvalid("shares_sum_mismatch");
      continue;
    }

    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      bumpInvalid("invalid_percentage");
      continue;
    }

    let lf: "L" | "F";
    if (rawLf === "L" || rawLf === "F") {
      lf = rawLf;
    } else if (rawDom.includes("INDONESIA")) {
      lf = "L";
    } else {
      lf = "F";
    }

    periodCounts.set(period, (periodCounts.get(period) ?? 0) + 1);

    rows.push({
      period,
      code: rawCode,
      issuerName: rawIssuer.replace(/\s+/g, " ").trim(),
      investorKey,
      investorName: investorKey,
      investorType: normalizeInvestorType(rawClass),
      localForeign: lf,
      scripless: Math.round(scripless),
      scrip: Math.round(scrip),
      totalShares: Math.round(total),
      pct: Math.round(pct * 10000) / 10000,
    });
  }

  if (rows.length === 0) {
    throw new Error("Tidak ada baris kepemilikan valid di berkas xlsx");
  }

  let dominantPeriod = rows[0].period;
  let maxCnt = 0;
  for (const [p, cnt] of periodCounts.entries()) {
    if (cnt > maxCnt) {
      maxCnt = cnt;
      dominantPeriod = p;
    }
  }

  return {
    period: dominantPeriod,
    rows,
    invalidCounts,
    headerRow,
  };
}

export async function importOwnershipXlsx(
  filePath: string,
  customDb?: DatabaseSync
): Promise<OwnershipImportSummary> {
  const parsed = await parseOwnershipXlsx(filePath);
  const db = customDb ?? getDb();

  const investorStats = new Map<
    string,
    { name: string; typeCounts: Map<string, number>; lCount: number; fCount: number }
  >();

  for (const r of parsed.rows) {
    let st = investorStats.get(r.investorKey);
    if (!st) {
      st = { name: r.investorName, typeCounts: new Map(), lCount: 0, fCount: 0 };
      investorStats.set(r.investorKey, st);
    }
    st.typeCounts.set(r.investorType, (st.typeCounts.get(r.investorType) ?? 0) + 1);
    if (r.localForeign === "L") st.lCount += 1;
    else st.fCount += 1;
  }

  const upsertStock = db.prepare(`
    INSERT INTO stocks (code, name)
    VALUES (?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name
  `);

  const upsertInvestor = db.prepare(`
    INSERT INTO investors (key, name, type, local_foreign)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      local_foreign = excluded.local_foreign
  `);

  const selectInvestorId = db.prepare(`SELECT id FROM investors WHERE key = ?`);

  const deletePeriodHoldings = db.prepare(`DELETE FROM holdings WHERE period = ?`);

  const upsertHolding = db.prepare(`
    INSERT INTO holdings (period, code, investor_id, shares_scripless, shares_scrip, total_shares, pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(period, code, investor_id) DO UPDATE SET
      shares_scripless = holdings.shares_scripless + excluded.shares_scripless,
      shares_scrip = holdings.shares_scrip + excluded.shares_scrip,
      total_shares = holdings.total_shares + excluded.total_shares,
      pct = ROUND(holdings.pct + excluded.pct, 4)
  `);

  const distinctStocks = new Set<string>();
  const distinctInvestors = new Set<string>();

  db.exec("BEGIN IMMEDIATE");
  try {
    const periodsInFile = new Set(parsed.rows.map((r) => r.period));
    for (const p of periodsInFile) {
      deletePeriodHoldings.run(p);
    }

    const investorIdByKey = new Map<string, number>();
    for (const [key, st] of investorStats.entries()) {
      let bestType = "Other";
      let bestCnt = -1;
      for (const [t, cnt] of st.typeCounts.entries()) {
        if (cnt > bestCnt && t !== "Other") {
          bestCnt = cnt;
          bestType = t;
        }
      }
      const lf: "L" | "F" = st.lCount >= st.fCount ? "L" : "F";
      upsertInvestor.run(key, st.name, bestType, lf);
      const idRow = selectInvestorId.get(key) as { id: number };
      investorIdByKey.set(key, idRow.id);
      distinctInvestors.add(key);
    }

    for (const r of parsed.rows) {
      upsertStock.run(r.code, r.issuerName);
      distinctStocks.add(r.code);
      const invId = investorIdByKey.get(r.investorKey)!;
      upsertHolding.run(
        r.period,
        r.code,
        invId,
        r.scripless,
        r.scrip,
        r.totalShares,
        r.pct
      );
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    file: filePath,
    period: parsed.period,
    importedRows: parsed.rows.length,
    distinctStocks: distinctStocks.size,
    distinctInvestors: distinctInvestors.size,
    invalidCounts: parsed.invalidCounts,
  };
}
