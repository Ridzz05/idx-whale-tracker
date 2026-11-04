import { describe, it, expect } from "vitest";
import { ALERT_COOLDOWN_MS, applyCooldown, detectAlerts, topMovers } from "@/market/alerts";
import { indexTimeToWib, isMarketHours } from "@/market/hours";
import { isIdxUrl } from "@/capture/relay";
import { parseIdNumber } from "@/capture/idx";
import type { Quote } from "@/market/types";

function quote(code: string, over: Partial<Quote> = {}): Quote {
  return {
    code,
    price: 1000,
    changePct: 0,
    open: 1000,
    high: 1000,
    low: 1000,
    volume: 1_000_000,
    valueTraded: 10_000_000_000,
    relVolume: 1,
    idxTime: "2026-11-04T10:00:00",
    ...over,
  };
}

const book = (...qs: Quote[]) => new Map(qs.map((q) => [q.code, q]));

describe("detectAlerts", () => {
  it("fires once when a stock crosses the 5% tier and again only when it crosses 10%", () => {
    const first = detectAlerts(book(quote("BBCA", { changePct: 4.9 })), [quote("BBCA", { changePct: 5.2 })], null);
    expect(first.map((a) => [a.kind, a.severity])).toEqual([["price_move", "warn"]]);

    const stay = detectAlerts(book(quote("BBCA", { changePct: 5.2 })), [quote("BBCA", { changePct: 7 })], null);
    expect(stay).toEqual([]);

    const jump = detectAlerts(book(quote("BBCA", { changePct: 7 })), [quote("BBCA", { changePct: 10.1 })], null);
    expect(jump.map((a) => a.severity)).toEqual(["high"]);
  });

  it("alerts on large drops with a distinct key from rises", () => {
    const [down] = detectAlerts(book(quote("GOTO", { changePct: -4 })), [quote("GOTO", { changePct: -6 })], null);
    const [up] = detectAlerts(book(quote("GOTO", { changePct: 4 })), [quote("GOTO", { changePct: 6 })], null);
    expect(down.title).toContain("turun");
    expect(up.title).toContain("naik");
    expect(down.key).not.toBe(up.key);
  });

  it("never alerts for a stock missing from the previous snapshot", () => {
    expect(detectAlerts(new Map(), [quote("NEWC", { changePct: 20, relVolume: 9 })], null)).toEqual([]);
  });

  it("ignores illiquid stocks even on extreme moves", () => {
    const thin = quote("THIN", { changePct: 25, valueTraded: 400_000_000 });
    expect(detectAlerts(book(quote("THIN", { valueTraded: 400_000_000 })), [thin], null)).toEqual([]);
  });

  it("fires a volume spike on crossing 3x and not again while it stays between tiers", () => {
    const spike = detectAlerts(book(quote("BUMI", { relVolume: 2.5 })), [quote("BUMI", { relVolume: 3.4 })], null);
    expect(spike.map((a) => a.kind)).toEqual(["volume_spike"]);
    expect(detectAlerts(book(quote("BUMI", { relVolume: 3.4 })), [quote("BUMI", { relVolume: 4.2 })], null)).toEqual([]);
  });

  it("sorts alerts by severity first, so an IHSG 2% move outranks a stock 5% move", () => {
    const prev = book(quote("IHSG", { changePct: 0.9 }), quote("BBCA", { changePct: 4 }));
    const alerts = detectAlerts(prev, [quote("BBCA", { changePct: 5.5 })], quote("IHSG", { changePct: 2.1, price: 7000 }));
    expect(alerts.map((a) => [a.code, a.severity])).toEqual([
      ["IHSG", "high"],
      ["BBCA", "warn"],
    ]);
  });

  it("alerts when IHSG crosses 1% then 2%, with the right direction", () => {
    const first = detectAlerts(book(quote("IHSG", { changePct: 0.9 })), [], quote("IHSG", { changePct: 1.2, price: 7000 }));
    expect(first[0]).toMatchObject({ code: "IHSG", severity: "warn" });
    const second = detectAlerts(book(quote("IHSG", { changePct: 1.2 })), [], quote("IHSG", { changePct: -2.1, price: 6800 }));
    expect(second[0]).toMatchObject({ code: "IHSG", severity: "high" });
    expect(second[0].title).toContain("turun");
  });
});

describe("applyCooldown", () => {
  const alert = { key: "BBCA|price_move|up|1", code: "BBCA", kind: "price_move", severity: "warn", title: "t", detail: "d", price: 1, changePct: 1 } as const;

  it("suppresses a repeat inside the window without extending it", () => {
    const fired = new Map<string, number>();
    expect(applyCooldown([alert], fired, 0)).toHaveLength(1);
    expect(applyCooldown([alert], fired, ALERT_COOLDOWN_MS - 1)).toHaveLength(0);
    expect(fired.get(alert.key)).toBe(0);
    expect(applyCooldown([alert], fired, ALERT_COOLDOWN_MS)).toHaveLength(1);
  });

  it("does not suppress a different tier of the same stock", () => {
    const fired = new Map<string, number>();
    applyCooldown([alert], fired, 0);
    const higher = { ...alert, key: "BBCA|price_move|up|2" };
    expect(applyCooldown([higher], fired, 1000)).toHaveLength(1);
  });
});

describe("topMovers", () => {
  it("ranks only liquid stocks and splits gainers from losers", () => {
    const { gainers, losers } = topMovers([
      quote("AAAA", { changePct: 3 }),
      quote("BBBB", { changePct: 9 }),
      quote("CCCC", { changePct: -4 }),
      quote("DDDD", { changePct: 40, valueTraded: 100_000_000 }),
      quote("EEEE", { changePct: 0 }),
    ]);
    expect(gainers.map((m) => m.code)).toEqual(["BBBB", "AAAA"]);
    expect(losers.map((m) => m.code)).toEqual(["CCCC"]);
  });
});

describe("isMarketHours", () => {
  it("is open on a weekday session and closed at night and on weekends (WIB)", () => {
    expect(isMarketHours(new Date("2026-11-04T03:00:00Z"))).toBe(true); // Wed 10:00 WIB
    expect(isMarketHours(new Date("2026-11-04T10:00:00Z"))).toBe(false); // Wed 17:00 WIB
    expect(isMarketHours(new Date("2026-11-04T01:30:00Z"))).toBe(false); // Wed 08:30 WIB
    expect(isMarketHours(new Date("2026-11-07T03:00:00Z"))).toBe(false); // Sat
  });
});

describe("relay origin gate", () => {
  it("accepts only https pages on www.idx.co.id", () => {
    expect(isIdxUrl("https://www.idx.co.id/id/produk/saham/")).toBe(true);
    expect(isIdxUrl("http://www.idx.co.id/")).toBe(false);
    expect(isIdxUrl("https://idx.co.id/")).toBe(false);
    expect(isIdxUrl("https://www.idx.co.id.evil.example/")).toBe(false);
    expect(isIdxUrl("https://evil.example/www.idx.co.id")).toBe(false);
    expect(isIdxUrl("https://mail.google.com/mail/u/0/#inbox")).toBe(false);
    expect(isIdxUrl("http://localhost:3000/investors")).toBe(false);
    expect(isIdxUrl("not a url")).toBe(false);
  });
});

describe("parseIdNumber", () => {
  it("reads the Indonesian number format IDX uses for indices", () => {
    expect(parseIdNumber("4.910,940")).toBeCloseTo(4910.94, 3);
    expect(parseIdNumber("500,250")).toBeCloseTo(500.25, 3);
    expect(parseIdNumber("11.723.012")).toBe(11723012);
    expect(Number.isNaN(parseIdNumber("-"))).toBe(true);
  });
});

describe("indexTimeToWib", () => {
  const at = (iso: string) => Date.parse(iso);

  it("attaches today's date to a clock time that is not in the future", () => {
    // Wed 2026-11-04 16:15 WIB, index last updated 16:00:00
    expect(indexTimeToWib("16:00:00", at("2026-11-04T09:15:00Z"))).toBe("2026-11-04T16:00:00");
  });

  it("rolls back one day when the time is later than now (before the open)", () => {
    // Thu 2026-11-05 07:00 WIB still shows yesterday's 16:00:00
    expect(indexTimeToWib("16:00:00", at("2026-11-05T00:00:00Z"))).toBe("2026-11-04T16:00:00");
  });

  it("skips the weekend, so Monday morning points at Friday", () => {
    // Mon 2026-11-09 07:00 WIB
    expect(indexTimeToWib("16:00:00", at("2026-11-08T23:00:00Z"))).toBe("2026-11-06T16:00:00");
  });

  it("accepts the HH:MM that IDX returns for today's index row", () => {
    expect(indexTimeToWib("16:00", at("2026-11-04T09:15:00Z"))).toBe("2026-11-04T16:00:00");
    expect(indexTimeToWib("9:05", at("2026-11-04T09:15:00Z"))).toBeNull();
  });

  it("returns null for anything that is not a clock time", () => {
    expect(indexTimeToWib(null, 0)).toBeNull();
    expect(indexTimeToWib("-", 0)).toBeNull();
    expect(indexTimeToWib("16", 0)).toBeNull();
  });
});
