import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initDb, resetDbForTests, getDb } from "@/db/client";
import { LIVE_KIND, upsertLiveDocs } from "@/rag/live";
import { retrieve } from "@/rag/retrieve";
import { saveCapture } from "@/market/store";
import type { FeedStatus, Quote } from "@/market/types";

const status: FeedStatus = {
  state: "ok",
  fetchedAt: Date.parse("2026-11-04T09:15:00Z"),
  marketOpen: true,
  moving: true,
  ihsg: { price: 4910.94, changePct: 0.14, idxTime: "16:00:00" },
  idxDataTime: "2026-11-04T16:00:00",
  lagSeconds: 900,
  watchlistSize: 1,
  gainers: [{ code: "BBCA", price: 4930, changePct: 1.86, valueTraded: 1_322_939_834_000 }],
  losers: [],
  error: null,
};

function quote(price: number): Quote {
  return {
    code: "BBCA",
    price,
    changePct: 1.86,
    open: 4840,
    high: 4980,
    low: 4830,
    volume: 269_099_800,
    valueTraded: 1_322_939_834_000,
    relVolume: 1.2,
    idxTime: "2026-11-04T16:15:42",
  };
}

function freshDb() {
  const db = new DatabaseSync(":memory:");
  initDb(db);
  resetDbForTests(db);
  return db;
}

describe("live RAG documents", () => {
  it("are findable by retrieve and carry the IDX data time", async () => {
    freshDb();
    upsertLiveDocs(status, [quote(4930)], []);

    const docs = await retrieve("harga live BBCA", 3);
    expect(docs[0]).toMatchObject({ kind: LIVE_KIND, ref: "live:BBCA" });
    expect(docs[0].snippet).toContain("Rp 4.930");
    expect(docs[0].snippet).toContain("2026-11-04 16:00:00 WIB");
  });

  it("are rewritten in place on the next tick instead of piling up", async () => {
    const db = freshDb();
    upsertLiveDocs(status, [quote(4930)], []);
    upsertLiveDocs(status, [quote(4960)], []);

    const rows = db.prepare(`SELECT body FROM docs WHERE ref = 'live:BBCA'`).all() as { body: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("Rp 4.960");
    expect(rows[0].body).not.toContain("Rp 4.930");

    const hits = await retrieve("harga live BBCA", 5);
    const bbca = hits.find((h) => h.ref === "live:BBCA");
    expect(bbca?.snippet).toContain("Rp 4.960");
    expect(bbca?.snippet).not.toContain("Rp 4.930");
  });
});

describe("saveCapture", () => {
  it("keeps the latest quote per stock and appends one history row per capture", () => {
    freshDb();
    saveCapture([quote(4930)], null, "2026-11-04T09:15:00.000Z");
    saveCapture([{ ...quote(4960), idxTime: "2026-11-04T16:16:42" }], null, "2026-11-04T09:16:00.000Z");

    const db = getDb();
    const latest = db.prepare(`SELECT price FROM idx_quotes WHERE code = 'BBCA'`).all() as { price: number }[];
    const history = db.prepare(`SELECT COUNT(*) AS n FROM idx_quote_history WHERE code = 'BBCA'`).get() as { n: number };
    expect(latest).toEqual([{ price: 4960 }]);
    expect(history.n).toBe(2);
  });
});
