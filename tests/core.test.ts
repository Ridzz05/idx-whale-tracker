import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scoreStock, type Candle } from "@/analytics/bandar";
import { computeSectorRotation } from "@/analytics/sector";
import {
  EXPECTED_HEADER,
  importOwnershipXlsx,
  parseOwnershipXlsx,
} from "@/ingest/ownership";
import { initDb, resetDbForTests } from "@/db/client";
import { whaleDeltas, isPeriodStale, periodAgeDays } from "@/db/queries";
import { retrieve } from "@/rag/retrieve";
import { assertSafePublicUrl } from "@/web/fetch";

describe("scoreStock (Bandar Detector)", () => {
  it("detects accumulation when close is near high with high volume over 7 sessions", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 21; i++) {
      const day = String(i + 1).padStart(2, "0");
      candles.push({
        date: `2026-10-${day}`,
        open: 1000,
        high: 1100,
        low: 1000,
        close: 1095, // mfm = (95 - 5)/100 = +0.9
        volume: i >= 14 ? 5_000_000 : 2_000_000,
      });
    }
    const res = scoreStock(candles);
    expect(res).not.toBeNull();
    expect(res!.signal).toBe("accumulation");
    expect(res!.score).toBeGreaterThanOrEqual(65);
    expect(res!.net_flow_7d).toBeGreaterThan(0);
  });

  it("detects distribution when close is near low", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 21; i++) {
      const day = String(i + 1).padStart(2, "0");
      candles.push({
        date: `2026-10-${day}`,
        open: 1090,
        high: 1100,
        low: 1000,
        close: 1005, // mfm = (5 - 95)/100 = -0.9
        volume: 3_000_000,
      });
    }
    const res = scoreStock(candles);
    expect(res).not.toBeNull();
    expect(res!.signal).toBe("distribution");
    expect(res!.score).toBeLessThanOrEqual(35);
    expect(res!.net_flow_7d).toBeLessThan(0);
  });

  it("handles H == L without NaN and filters out low liquidity (< Rp 1B)", () => {
    const flatCandles: Candle[] = [];
    for (let i = 0; i < 21; i++) {
      const day = String(i + 1).padStart(2, "0");
      flatCandles.push({
        date: `2026-10-${day}`,
        open: 2000,
        high: 2000,
        low: 2000,
        close: 2000,
        volume: 1_000_000, // 2B IDR per day
      });
    }
    const flatRes = scoreStock(flatCandles);
    expect(flatRes).not.toBeNull();
    expect(Number.isNaN(flatRes!.cmf20)).toBe(false);
    expect(flatRes!.score).toBe(50);
    expect(flatRes!.signal).toBeNull();

    const illiquidCandles: Candle[] = flatCandles.map((c) => ({
      ...c,
      close: 100,
      volume: 100_000, // 10M IDR < 1B IDR
    }));
    expect(scoreStock(illiquidCandles)).toBeNull();
  });
});

describe("computeSectorRotation", () => {
  it("computes exact 5d, 21d, 63d sector returns and relative vs IHSG", () => {
    const makeSeries = (start: number, stepRatio5: number, stepRatio21: number) => {
      const arr: { date: string; close: number }[] = [];
      for (let i = 0; i < 65; i++) {
        const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        let close = start;
        if (i === 64 - 21) close = 100;
        if (i === 64 - 5) close = 110;
        if (i === 64) close = 100 * stepRatio21;
        if (i === 64 - 63) close = 80;
        arr.push({ date: d, close });
      }
      // Adjust exact anchor points:
      // last index = 64; 64-5 = 59; 64-21 = 43; 64-63 = 1
      const lastClose = 120;
      arr[64].close = lastClose;
      arr[59].close = lastClose / stepRatio5;
      arr[43].close = lastClose / stepRatio21;
      arr[1].close = lastClose / 1.5;
      return arr;
    };

    const ihsg = makeSeries(100, 1.02, 1.05); // 21d = +5%
    const s1 = makeSeries(100, 1.04, 1.15); // 21d = +15%
    const s2 = makeSeries(100, 1.06, 1.25); // 21d = +25%
    const s3 = makeSeries(100, 0.98, 0.95); // 21d = -5%

    const res = computeSectorRotation(
      [
        { code: "AAA", sector: "Energy", closes: s1 },
        { code: "BBB", sector: "Energy", closes: s2 },
        { code: "CCC", sector: "Tech", closes: s3 },
      ],
      ihsg
    );

    expect(res.ihsg.ret21d).toBeCloseTo(0.05, 6);
    expect(res.sectors.length).toBe(2);
    expect(res.sectors[0].sector).toBe("Energy");
    expect(res.sectors[0].ret21d).toBeCloseTo(0.2, 6); // mean(0.15, 0.25)
    expect(res.sectors[0].rel21d).toBeCloseTo(0.15, 6); // 0.20 - 0.05
    expect(res.sectors[1].sector).toBe("Tech");
    expect(res.sectors[1].ret21d).toBeCloseTo(-0.05, 6);
    expect(res.sectors[1].rel21d).toBeCloseTo(-0.1, 6);
  });
});

describe("ownership xlsx parser & importer", () => {
  it("finds dynamic header on row 4, rejects bad rows with counts, sums duplicates, and maps Corporate -> Corporation", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
    const goodXlsx = path.join(tmpDir, "good.xlsx");
    const badHeaderXlsx = path.join(tmpDir, "bad.xlsx");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet 1");
    ws.addRow(["Disclaimer baris 1"]);
    ws.addRow(["Disclaimer baris 2"]);
    ws.addRow([]);
    ws.addRow([...EXPECTED_HEADER]);
    // Valid row 1 (duplicate investor+stock part 1)
    ws.addRow([
      "30-Sep-2026",
      "AADI",
      "ADARO ANDALAN INDONESIA Tbk",
      "ADARO STRATEGIC INVESTMENTS",
      "Corporate",
      "L",
      "INDONESIA",
      "INDONESIA",
      1000,
      0,
      1000,
      10.5,
    ]);
    // Valid row 2 (duplicate investor+stock part 2 -> should sum pct to 15.75)
    ws.addRow([
      "30-Sep-2026",
      "AADI",
      "ADARO ANDALAN INDONESIA Tbk",
      "ADARO STRATEGIC INVESTMENTS",
      "Corporate",
      "L",
      "INDONESIA",
      "INDONESIA",
      500,
      0,
      500,
      5.25,
    ]);
    // Invalid row: TOTAL != SCRIPLESS + SCRIP
    ws.addRow([
      "30-Sep-2026",
      "BBCA",
      "BANK CENTRAL ASIA Tbk",
      "BAD INVESTOR",
      "Individual",
      "L",
      "INDONESIA",
      "INDONESIA",
      100,
      50,
      999,
      2.0,
    ]);
    await wb.xlsx.writeFile(goodXlsx);

    const parsed = await parseOwnershipXlsx(goodXlsx);
    expect(parsed.headerRow).toBe(4);
    expect(parsed.rows.length).toBe(2);
    expect(parsed.invalidCounts.shares_sum_mismatch).toBe(1);
    expect(parsed.rows[0].investorType).toBe("Corporation");

    const memDb = new DatabaseSync(":memory:");
    initDb(memDb);
    resetDbForTests(memDb);

    const summary = await importOwnershipXlsx(goodXlsx, memDb);
    expect(summary.importedRows).toBe(2);
    expect(summary.distinctStocks).toBe(1);
    expect(summary.distinctInvestors).toBe(1);

    const hRow = memDb
      .prepare(`SELECT total_shares, pct FROM holdings WHERE code = 'AADI'`)
      .get() as { total_shares: number; pct: number };
    expect(hRow.total_shares).toBe(1500);
    expect(hRow.pct).toBeCloseTo(15.75, 4);

    const wbBad = new ExcelJS.Workbook();
    const wsBad = wbBad.addWorksheet("Sheet 1");
    wsBad.addRow(["DATE", "SHARE_CODE", "WRONG_COL"]);
    await wbBad.xlsx.writeFile(badHeaderXlsx);
    await expect(parseOwnershipXlsx(badHeaderXlsx)).rejects.toThrow(/Header/);
  });
});

describe("RAG FTS5 retrieve safety & SSRF protection", () => {
  it("does not throw on quotes, %, OR, or punctuation in retrieve query", async () => {
    const memDb = new DatabaseSync(":memory:");
    initDb(memDb);
    resetDbForTests(memDb);

    memDb
      .prepare(
        `INSERT INTO docs (kind, ref, title, body, source_url, created_at)
         VALUES ('stock', 'stock:AADI', 'Saham AADI', 'Pemegang terbesar ADARO STRATEGIC INVESTMENTS 41.1%', NULL, '2026-11-04')`
      )
      .run();

    const docs = await retrieve('siapa "pemegang" 100% OR AND (AADI)* ?', 5);
    expect(docs.length).toBe(1);
    expect(docs[0].ref).toBe("stock:AADI");
  });

  it("rejects loopback and private IPs in assertSafePublicUrl", () => {
    expect(() => assertSafePublicUrl("http://127.0.0.1:3000/secret")).toThrow(/SSRF/);
    expect(() => assertSafePublicUrl("http://localhost:8080/")).toThrow(/SSRF/);
    expect(() => assertSafePublicUrl("http://192.168.1.1/")).toThrow(/SSRF/);
    expect(() => assertSafePublicUrl("http://10.0.0.1/")).toThrow(/SSRF/);
    expect(() => assertSafePublicUrl("file:///etc/passwd")).toThrow(/Protokol/);
    expect(assertSafePublicUrl("https://www.idx.co.id/").hostname).toBe("www.idx.co.id");
  });
});

describe("whaleDeltas", () => {
  it("reports buys, sells, entrants and exits between two periods", () => {
    const db = new DatabaseSync(":memory:");
    initDb(db);
    resetDbForTests(db);

    db.prepare(`INSERT INTO stocks (code, name, sector, last_price) VALUES ('AAAA', 'Saham A', 'Energi', 100)`).run();
    const addInvestor = db.prepare(`INSERT INTO investors (id, key, name, type, local_foreign) VALUES (?, ?, ?, 'Corporation', ?)`);
    addInvestor.run(1, "k1", "PEMBELI", "L");
    addInvestor.run(2, "k2", "PENJUAL", "F");
    addInvestor.run(3, "k3", "PENDATANG", "L");
    addInvestor.run(4, "k4", "PERGI", "F");
    addInvestor.run(5, "k5", "DIAM", "L");

    const addHolding = db.prepare(
      `INSERT INTO holdings (period, code, investor_id, shares_scripless, shares_scrip, total_shares, pct)
       VALUES (?, 'AAAA', ?, ?, 0, ?, ?)`
    );
    // Previous period: 1 buys later, 2 sells later, 4 leaves, 5 unchanged.
    addHolding.run("2026-08-31", 1, 1_000, 1_000, 1);
    addHolding.run("2026-08-31", 2, 5_000, 5_000, 5);
    addHolding.run("2026-08-31", 4, 2_000, 2_000, 2);
    addHolding.run("2026-08-31", 5, 3_000, 3_000, 3);
    // Current period: 1 up, 2 down, 3 new, 4 gone, 5 unchanged.
    addHolding.run("2026-09-30", 1, 4_000, 4_000, 4);
    addHolding.run("2026-09-30", 2, 1_000, 1_000, 1);
    addHolding.run("2026-09-30", 3, 7_000, 7_000, 7);
    addHolding.run("2026-09-30", 5, 3_000, 3_000, 3);

    const rows = whaleDeltas("2026-08-31", "2026-09-30");
    const byId = new Map(rows.map((r) => [r.investor_id, r]));

    expect(rows.length).toBe(4); // the unchanged holder is dropped
    expect(byId.get(1)?.status).toBe("up");
    expect(byId.get(1)?.delta_shares).toBe(3_000);
    expect(byId.get(1)?.delta_pct).toBeCloseTo(3, 6);
    expect(byId.get(1)?.delta_value_idr).toBe(300_000); // 3.000 lembar x Rp100
    expect(byId.get(2)?.status).toBe("down");
    expect(byId.get(2)?.delta_shares).toBe(-4_000);
    expect(byId.get(3)?.status).toBe("new");
    expect(byId.get(3)?.prev_shares).toBe(0);
    expect(byId.get(4)?.status).toBe("exit");
    expect(byId.get(4)?.cur_shares).toBe(0);
    expect(byId.get(4)?.delta_shares).toBe(-2_000);
    expect(byId.has(5)).toBe(false);
  });
});

describe("isPeriodStale", () => {
  const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("treats the 45th day as on time and the 46th as stale", () => {
    expect(periodAgeDays("2026-09-30", at("2026-11-14"))).toBe(45);
    expect(isPeriodStale("2026-09-30", at("2026-11-14"))).toBe(false);
    expect(isPeriodStale("2026-09-30", at("2026-11-15"))).toBe(true);
  });

  it("keeps a fresh period quiet and flags the 56-day lag seen in practice", () => {
    expect(isPeriodStale("2026-09-30", at("2026-11-04"))).toBe(false); // 35 days
    expect(periodAgeDays("2026-08-31", at("2026-10-26"))).toBe(56);
    expect(isPeriodStale("2026-08-31", at("2026-10-26"))).toBe(true);
  });
});
