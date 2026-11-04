"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeedEventSchema, type FeedStatus, type MarketAlert } from "./types";

const STORAGE_KEY = "whale.alerts.lastSeenId";
const MAX_ALERTS = 50;
const MAX_TOASTS = 3;
const TOAST_MS = 8000;

export interface MarketFeedView {
  status: FeedStatus | null;
  alerts: MarketAlert[];
  connected: boolean;
  unread: number;
  toasts: MarketAlert[];
  dismissToast: (id: number) => void;
  markAllRead: () => void;
}

export function useMarketFeed(): MarketFeedView {
  const [status, setStatus] = useState<FeedStatus | null>(null);
  const [alerts, setAlerts] = useState<MarketAlert[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const [toasts, setToasts] = useState<MarketAlert[]>([]);
  const lastSeenRef = useRef(0);

  const persistSeen = useCallback((id: number) => {
    lastSeenRef.current = id;
    setLastSeen(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // Storage can be blocked; the unread badge then resets on reload.
    }
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/market/stream");

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (e: MessageEvent<string>) => {
      let json: unknown;
      try {
        json = JSON.parse(e.data);
      } catch {
        return;
      }
      const parsed = FeedEventSchema.safeParse(json);
      if (!parsed.success) return;
      const event = parsed.data;

      if (event.type === "hello") {
        setStatus(event.status);
        setAlerts(event.alerts);
        const newest = event.alerts[0]?.id ?? 0;
        let stored: number | null = null;
        try {
          const raw = window.localStorage.getItem(STORAGE_KEY);
          stored = raw === null ? null : Number(raw);
        } catch {
          stored = null;
        }
        // A first-ever visit starts clean instead of showing history as unread.
        persistSeen(stored !== null && Number.isFinite(stored) ? stored : newest);
      } else if (event.type === "status") {
        setStatus(event.status);
      } else {
        const alert = event.alert;
        setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, MAX_ALERTS));
        if (alert.severity !== "info") {
          setToasts((prev) => [alert, ...prev].slice(0, MAX_TOASTS));
          window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== alert.id)), TOAST_MS);
        }
      }
    };

    return () => source.close();
  }, [persistSeen]);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    const newest = alerts[0]?.id ?? lastSeenRef.current;
    persistSeen(Math.max(newest, lastSeenRef.current));
  }, [alerts, persistSeen]);

  const unread = alerts.filter((a) => a.id > lastSeen).length;

  return { status, alerts, connected, unread, toasts, dismissToast, markAllRead };
}
