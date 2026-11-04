import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getRelay } from "./relay";

const CodesSchema = z.array(z.string().regex(/^[A-Z0-9]{4}$/)).max(300);

/** IDX answered 429 or 403 mid-cycle. The poller backs off instead of retrying. */
export class IdxBlockedError extends Error {
  constructor(
    readonly status: number,
    readonly received: number,
    readonly requested: number
  ) {
    super(`IDX membalas HTTP ${status} setelah ${received} dari ${requested} saham.`);
    this.name = "IdxBlockedError";
  }
}

/** Runs inside the IDX page, so requests carry the real browser's cookies and TLS fingerprint. */
const PRELUDE = `
const J = async (p) => {
  const r = await fetch("https://www.idx.co.id/primary" + p, { credentials: "include" });
  if (!r.ok) throw new Error(p.split("?")[0] + " HTTP " + r.status);
  return r.json();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));`;

function script(body: string): string {
  return `(async () => { ${PRELUDE} ${body} })()`;
}

export interface LiveQuote {
  code: string;
  close: number;
  prev: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  value: number;
  /**
   * IDX record creation time (WIB, no zone suffix). It was observed to follow the
   * request time rather than the trade time, so it is not evidence of freshness.
   */
  dt: string;
}

const LiveResultSchema = z.object({
  rows: z.array(
    z.object({
      code: z.string(),
      close: z.number(),
      prev: z.number(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      volume: z.number(),
      value: z.number(),
      dt: z.string(),
    })
  ),
  blocked: z.object({ status: z.number() }).nullable(),
});

/**
 * The relay gives one Runtime.evaluate about 65 seconds ("Chrome sent no answer within
 * 65000ms"), and a 30-stock cycle at the default gap runs longer than that. A cycle is
 * therefore split into chunks that each finish well inside the cap.
 */
const CHUNK_SIZE = 12;

async function fetchChunk(codes: string[], gap: number): Promise<z.infer<typeof LiveResultSchema>> {
  const budget = codes.length * (gap * 1.4 + 700) + 10_000;
  return getRelay().evaluate(
    script(`
      const codes = ${JSON.stringify(codes)};
      const gap = ${gap};
      const rows = [];
      let blocked = null;
      for (let i = 0; i < codes.length; i++) {
        const r = await fetch("https://www.idx.co.id/primary/ListedCompany/GetTradingInfoDaily?code=" + codes[i], { credentials: "include" });
        if (r.status === 429 || r.status === 403) { blocked = { status: r.status }; break; }
        if (r.ok) {
          const j = await r.json();
          if (j.ClosingPrice > 0) rows.push({
            code: codes[i], close: j.ClosingPrice, prev: j.PreviousPrice, open: j.OpeningPrice || j.ClosingPrice,
            high: j.HighestPrice || j.ClosingPrice, low: j.LowestPrice || j.ClosingPrice,
            volume: j.TradedVolume, value: j.TradedValue, dt: j.DTCreate });
        }
        if (i < codes.length - 1) await sleep(gap + Math.random() * gap * 0.4);
      }
      return { rows, blocked };
    `),
    LiveResultSchema,
    budget,
    "GetTradingInfoDaily"
  );
}

/**
 * Per-ticker intraday snapshot from GetTradingInfoDaily, one request at a time with a
 * jittered gap. IDX rate-limits this endpoint hard: 6 parallel requests got 29 of 50
 * answered with 429 and 6 with 403 in the first test, so there is no parallelism here.
 */
export async function fetchLiveQuotes(codes: string[]): Promise<LiveQuote[]> {
  const safe = CodesSchema.parse(codes);
  const gap = getEnv().IDX_REQUEST_GAP_MS;
  const rows: LiveQuote[] = [];

  for (let start = 0; start < safe.length; start += CHUNK_SIZE) {
    const chunk = await fetchChunk(safe.slice(start, start + CHUNK_SIZE), gap);
    rows.push(...chunk.rows);
    if (chunk.blocked) {
      // A 403 is a Cloudflare challenge on this tab; steer the next attempt to another IDX tab.
      if (chunk.blocked.status === 403) getRelay().quarantineSession();
      throw new IdxBlockedError(chunk.blocked.status, rows.length, safe.length);
    }
    if (start + CHUNK_SIZE < safe.length) await sleep(gap);
  }

  if (safe.length >= 10 && rows.length < safe.length / 2) {
    throw new Error(`IDX hanya mengembalikan data untuk ${rows.length} dari ${safe.length} saham.`);
  }
  return rows;
}

export interface IndexQuote {
  code: string;
  current: number;
  previousClose: number;
  /** "HH:MM:SS" WIB, the index update time as published by IDX. */
  time: string | null;
}

const IndexListSchema = z.array(
  z.object({ IndexCode: z.string(), Current: z.string(), Closing: z.string(), Time: z.string().nullable().optional() })
);

/** IDX formats numbers the Indonesian way: "4.910,940". */
export function parseIdNumber(s: string): number {
  return Number(s.replace(/\./g, "").replace(",", "."));
}

export async function fetchIndexList(): Promise<IndexQuote[]> {
  const rows = await getRelay().evaluate(
    script(`return await J("/Home/GetIndexList");`),
    IndexListSchema,
    45_000,
    "GetIndexList"
  );
  return rows
    .map((r) => ({
      code: r.IndexCode,
      current: parseIdNumber(r.Current),
      previousClose: parseIdNumber(r.Closing),
      time: r.Time ?? null,
    }))
    .filter((r) => Number.isFinite(r.current) && Number.isFinite(r.previousClose) && r.previousClose > 0);
}

const SummarySchema = z.array(z.object({ code: z.string(), value: z.number() }));

/** The latest completed day's most traded tickers; the live watchlist is built from it. */
export async function fetchTopByValue(n: number): Promise<string[]> {
  const rows = await getRelay().evaluate(
    script(`
      const j = await J("/TradingSummary/GetStockSummary?length=9999&start=0");
      return (j.data || []).filter((x) => /^[A-Z0-9]{4}$/.test(x.StockCode)).map((x) => ({ code: x.StockCode, value: x.Value || 0 }));
    `),
    SummarySchema,
    45_000,
    "GetStockSummary"
  );
  const codes = rows
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
    .map((r) => r.code);
  if (codes.length === 0) throw new Error("GetStockSummary kosong; tidak bisa menyusun watchlist.");
  return codes;
}

const CalendarSchema = z.object({
  code: z.string(),
  dates: z.array(z.string()),
});

/** Trading calendar from one ticker's own history: length=250 gave 250 sessions in the probe. */
export async function fetchTradingCalendar(sessions: number): Promise<string[]> {
  const n = z.number().int().min(10).max(250).parse(sessions);
  const res = await getRelay().evaluate(
    script(`
      const j = await J("/ListedCompany/GetTradingInfoSS?code=BBCA&length=${n}");
      const rows = j.replies || [];
      return { code: "BBCA", dates: rows.map((r) => String(r.Date).slice(0, 10)).filter((d) => /^\\d{4}-\\d{2}-\\d{2}$/.test(d)) };
    `),
    CalendarSchema,
    45_000,
    "GetTradingInfoSS"
  );
  // IDX publishes a day's summary after that session closes, so today is included and
  // simply comes back empty before then; fetchDayData drops empty days instead of failing.
  return [...new Set(res.dates)].sort();
}

const DayResultSchema = z.object({
  date: z.string(),
  stocks: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number(),
    })
  ),
  index: z.object({ close: z.number(), previous: z.number(), high: z.number(), low: z.number(), volume: z.number() }).nullable(),
});

export interface DayData {
  date: string;
  stocks: z.infer<typeof DayResultSchema>["stocks"];
  index: z.infer<typeof DayResultSchema>["index"];
}

/** One request per trading date returns every listed stock; the same date also yields IHSG. */
async function fetchDayChunk(dates: string[], gap: number): Promise<DayData[]> {
  // ~10 dates per call keeps each Runtime.evaluate inside the relay's 65 second cap.
  const budget = dates.length * (gap * 2 + 1200) + 12_000;
  return getRelay().evaluate(
    script(`
      const dates = ${JSON.stringify(dates)};
      const gap = ${gap};
      const out = [];
      for (let i = 0; i < dates.length; i++) {
        const ymd = dates[i].replace(/-/g, "");
        const t0 = await fetch("https://www.idx.co.id/primary/TradingSummary/GetStockSummary?date=" + ymd + "&start=0&length=9999", { credentials: "include" });
        if (!t0.ok) throw new Error("GetStockSummary " + dates[i] + " HTTP " + t0.status);
        const j = await t0.json();
        const stocks = (j.data || [])
          .filter((x) => /^[A-Z0-9]{4}$/.test(x.StockCode) && x.Close > 0)
          .map((x) => ({ code: x.StockCode, name: String(x.StockName || "").trim(), open: x.OpenPrice || x.Close, high: x.High || x.Close, low: x.Low || x.Close, close: x.Close, volume: x.Volume || 0 }));
        await sleep(gap);
        const ti = await fetch("https://www.idx.co.id/primary/TradingSummary/GetIndexSummary?date=" + ymd + "&start=0&length=100", { credentials: "include" });
        const ij = ti.ok ? await ti.json() : { data: [] };
        const c = (ij.data || []).find((x) => x.IndexCode === "COMPOSITE");
        out.push({ date: dates[i], stocks, index: c && c.Close > 0 ? { close: c.Close, previous: c.Previous, high: c.Highest, low: c.Lowest, volume: c.Volume || 0 } : null });
        if (i < dates.length - 1) await sleep(gap);
      }
      return out;
    `),
    z.array(DayResultSchema),
    budget,
    "GetStockSummary+GetIndexSummary"
  );
}

/**
 * Fetches day data in chunks. A failing chunk is recorded and skipped so one bad date
 * does not discard the rest of the backfill.
 */
export async function fetchDayData(
  dates: string[],
  failed: { date: string; reason: string }[] = []
): Promise<DayData[]> {
  const gap = getEnv().IDX_REQUEST_GAP_MS;
  const out: DayData[] = [];
  for (let i = 0; i < dates.length; i += 8) {
    const chunk = dates.slice(i, i + 8);
    try {
      out.push(...(await fetchDayChunk(chunk, gap)));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      for (const d of chunk) failed.push({ date: d, reason });
    }
    if (i + 8 < dates.length) await sleep(gap);
  }
  return out;
}

const ProfilesListSchema = z.array(
  z.object({ code: z.string(), name: z.string(), sector: z.string().nullable(), industry: z.string().nullable() })
);

/** Company directory with IDX's own sector and industry classification. */
export async function fetchCompanyProfiles(): Promise<z.infer<typeof ProfilesListSchema>> {
  return getRelay().evaluate(
    script(`
      const j = await J("/ListedCompany/GetCompanyProfiles?emitenType=s&start=0&length=2000");
      return (j.data || []).filter((x) => /^[A-Z0-9]{4}$/.test(x.KodeEmiten)).map((x) => ({
        code: x.KodeEmiten, name: String(x.NamaEmiten || "").trim(), sector: x.Sektor || null, industry: x.Industri || null }));
    `),
    ProfilesListSchema,
    60_000,
    "GetCompanyProfiles"
  );
}
