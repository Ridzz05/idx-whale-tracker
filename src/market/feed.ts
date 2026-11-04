import { setTimeout as sleep } from "node:timers/promises";
import { fetchIndexList, fetchLiveQuotes, fetchTopByValue, IdxBlockedError, type LiveQuote } from "@/capture/idx";
import { getEnv } from "@/lib/env";
import { upsertLiveDocs } from "@/rag/live";
import { applyCooldown, detectAlerts, topMovers } from "./alerts";
import { indexTimeToWib, intervalFor, isMarketHours, wibDate } from "./hours";
import { loadAvgVolume, recentAlerts, saveAlert, saveCapture } from "./store";
import type { FeedEvent, FeedStatus, MarketAlert, Quote } from "./types";

type Listener = (event: FeedEvent) => void;

interface FeedState {
  started: boolean;
  prev: Map<string, Quote>;
  lastFired: Map<string, number>;
  lastChangeAt: number | null;
  listeners: Set<Listener>;
  status: FeedStatus;
  watchlist: string[];
  watchlistDate: string | null;
  avgVolume: Map<string, number>;
}

declare global {
  var __whaleFeed: FeedState | undefined;
}

export interface Feed {
  status(): FeedStatus;
  quote(code: string): Quote | undefined;
  recentAlerts(limit?: number): MarketAlert[];
  subscribe(listener: Listener): () => void;
}

const ERROR_RETRY_MS = 60_000;
/** After IDX answers 429/403 the poller stays quiet this long so it does not dig the block deeper. */
const BLOCK_BACKOFF_MS = 10 * 60_000;
const MOVING_WINDOW_MS = 180_000;

function initialState(): FeedState {
  return {
    started: false,
    prev: new Map(),
    lastFired: new Map(),
    lastChangeAt: null,
    listeners: new Set(),
    watchlist: [],
    watchlistDate: null,
    avgVolume: new Map(),
    status: {
      state: "connecting",
      fetchedAt: null,
      marketOpen: isMarketHours(new Date()),
      moving: null,
      ihsg: null,
      idxDataTime: null,
      lagSeconds: null,
      watchlistSize: 0,
      gainers: [],
      losers: [],
      error: null,
    },
  };
}

// The poller must survive Next module reloads and be shared by route handlers,
// pages and instrumentation, which can each load their own copy of this module.
function state(): FeedState {
  globalThis.__whaleFeed ??= initialState();
  return globalThis.__whaleFeed;
}

function emit(s: FeedState, event: FeedEvent) {
  for (const listener of s.listeners) {
    try {
      listener(event);
    } catch {
      // A listener that throws belongs to a closed stream.
      s.listeners.delete(listener);
    }
  }
}

function hasChanged(prev: ReadonlyMap<string, Quote>, next: ReadonlyMap<string, Quote>): boolean {
  for (const [code, q] of next) {
    const p = prev.get(code);
    if (p && (p.volume !== q.volume || p.price !== q.price)) return true;
  }
  return false;
}

function toQuote(l: LiveQuote, avgVolume: ReadonlyMap<string, number>): Quote {
  const avg = avgVolume.get(l.code);
  return {
    code: l.code,
    price: l.close,
    changePct: l.prev > 0 ? ((l.close - l.prev) / l.prev) * 100 : 0,
    open: l.open,
    high: l.high,
    low: l.low,
    volume: l.volume,
    valueTraded: l.value,
    relVolume: avg && avg > 0 ? l.volume / avg : null,
    idxTime: l.dt,
  };
}

async function tick(s: FeedState) {
  let delayMs = ERROR_RETRY_MS;
  try {
    const now = new Date();
    const today = wibDate(now);
    if (s.watchlistDate !== today || s.watchlist.length === 0) {
      s.watchlist = await fetchTopByValue(getEnv().IDX_WATCHLIST_SIZE);
      s.watchlistDate = today;
      s.avgVolume = loadAvgVolume(today);
    }

    // Sequential on purpose: IDX rate-limits parallel requests (see fetchLiveQuotes).
    const live = await fetchLiveQuotes(s.watchlist);
    const indexes = await fetchIndexList();
    const fetchedAt = Date.now();
    const quotes = live.map((l) => toQuote(l, s.avgVolume));

    const composite = indexes.find((i) => i.code === "COMPOSITE") ?? null;
    const ihsg: Quote | null = composite
      ? {
          code: "IHSG",
          price: composite.current,
          changePct: ((composite.current - composite.previousClose) / composite.previousClose) * 100,
          open: null,
          high: null,
          low: null,
          volume: null,
          valueTraded: null,
          relVolume: null,
          idxTime: composite.time,
        }
      : null;

    const next = new Map<string, Quote>(quotes.map((q) => [q.code, q]));
    if (ihsg) next.set("IHSG", ihsg);

    const hadPrev = s.prev.size > 0;
    if (hadPrev && hasChanged(s.prev, next)) s.lastChangeAt = fetchedAt;
    const moving = hadPrev ? s.lastChangeAt !== null && fetchedAt - s.lastChangeAt < MOVING_WINDOW_MS : null;

    const raw = hadPrev ? detectAlerts(s.prev, quotes, ihsg) : [];
    const fresh = applyCooldown(raw, s.lastFired, fetchedAt);
    s.prev = next;

    // GetTradingInfoDaily's DTCreate follows the request time, so freshness comes from
    // the index update time that GetIndexList publishes.
    const idxDataTime = indexTimeToWib(composite?.time ?? null, fetchedAt);
    const { gainers, losers } = topMovers(quotes);
    s.status = {
      state: "ok",
      fetchedAt,
      marketOpen: isMarketHours(now),
      moving,
      ihsg: ihsg ? { price: ihsg.price, changePct: ihsg.changePct, idxTime: ihsg.idxTime } : null,
      idxDataTime,
      lagSeconds: idxDataTime ? Math.round((fetchedAt - Date.parse(`${idxDataTime}+07:00`)) / 1000) : null,
      watchlistSize: quotes.length,
      gainers,
      losers,
      error: null,
    };

    try {
      saveCapture(quotes, ihsg, new Date(fetchedAt).toISOString());
    } catch (err) {
      console.error("[market-feed] gagal menyimpan capture", err);
    }

    for (const alert of fresh) {
      try {
        emit(s, { type: "alert", alert: saveAlert(alert) });
      } catch (err) {
        console.error("[market-feed] gagal menyimpan alert", alert.key, err);
      }
    }

    if (moving !== false) {
      try {
        upsertLiveDocs(s.status, quotes, recentAlerts(10));
      } catch (err) {
        console.error("[market-feed] gagal memperbarui dokumen RAG live", err);
      }
    }

    emit(s, { type: "status", status: s.status });
    delayMs = intervalFor(now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = err instanceof IdxBlockedError;
    console.error("[market-feed] capture gagal:", message);
    s.status = {
      ...s.status,
      state: "error",
      error: blocked ? `${message} Capture dijeda ${BLOCK_BACKOFF_MS / 60_000} menit.` : message,
      marketOpen: isMarketHours(new Date()),
    };
    emit(s, { type: "status", status: s.status });
    if (blocked) delayMs = BLOCK_BACKOFF_MS;
  }
  await sleep(delayMs);
  void tick(s);
}

/** Starts the poller on first call; every later call only returns the shared handle. */
export function ensureFeed(): Feed {
  const s = state();
  if (!s.started) {
    s.started = true;
    void tick(s);
  }
  return {
    status: () => s.status,
    quote: (code) => s.prev.get(code.toUpperCase()),
    recentAlerts,
    subscribe(listener) {
      s.listeners.add(listener);
      return () => {
        s.listeners.delete(listener);
      };
    },
  };
}
