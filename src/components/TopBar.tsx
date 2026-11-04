"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Activity, Bell, BellRing, TrendingDown, TrendingUp, WifiOff, X } from "lucide-react";
import { useMarketFeed } from "@/market/useMarketFeed";
import type { FeedStatus, MarketAlert } from "@/market/types";

const SEVERITY_LABEL = { high: "Tinggi", warn: "Waspada", info: "Info" } as const;
const SEVERITY_TONE = { high: "text-loss", warn: "text-amber", info: "text-muted" } as const;

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

function wib(iso: string | number): string {
  return `${timeFormat.format(new Date(iso)).replace(".", ":")} WIB`;
}

function signed(n: number): string {
  return `${n > 0 ? "▲ +" : n < 0 ? "▼ " : ""}${n.toFixed(2).replace(".", ",")}%`;
}

function AlertIcon({ alert }: { alert: MarketAlert }) {
  const cls = `h-5 w-5 shrink-0 ${SEVERITY_TONE[alert.severity]}`;
  if (alert.kind === "volume_spike") return <Activity aria-hidden className={cls} />;
  return (alert.changePct ?? 0) >= 0 ? (
    <TrendingUp aria-hidden className={cls} />
  ) : (
    <TrendingDown aria-hidden className={cls} />
  );
}

function AlertRow({ alert }: { alert: MarketAlert }) {
  const href = alert.code === "IHSG" ? "/sector-rotation" : `/stocks/${alert.code}`;
  return (
    <li>
      <Link href={href} className="flex min-h-11 gap-3 rounded-control px-3 py-2 hover:bg-highlight/60">
        <AlertIcon alert={alert} />
        <span className="min-w-0 flex-1">
          <span className="block text-base">{alert.title}</span>
          <span className="block text-sm text-muted">{alert.detail}</span>
          <span className="mt-0.5 block text-sm text-muted">
            <span className={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</span>
            {" · "}
            <span className="font-mono">{wib(alert.ts)}</span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function lagText(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 90) return `selisih ${Math.max(0, seconds)} dtk`;
  return `selisih ${Math.round(seconds / 60)} mnt`;
}

function feedLabel(status: FeedStatus | null, connected: boolean): { text: string; sub: string | null; bad: boolean } {
  if (!connected || status?.state === "error") {
    return { text: "Capture terputus", sub: status?.error ?? "Mencoba menyambung ulang", bad: true };
  }
  if (!status || status.state === "connecting" || status.fetchedAt === null) {
    return { text: "Menghubungkan ke IDX", sub: null, bad: false };
  }
  const stamp = status.idxDataTime ? `Data IDX ${status.idxDataTime.slice(11, 16)} WIB` : "Waktu data IDX belum ada";
  const motion = !status.marketOpen
    ? null
    : status.moving === null
      ? "baru terhubung"
      : status.moving
        ? "data bergerak"
        : "data tidak berubah";
  const sub = [stamp, motion, status.marketOpen ? lagText(status.lagSeconds) : null].filter(Boolean).join(" · ");
  return { text: status.marketOpen ? "Live dari IDX" : "IDX, pasar tutup", sub, bad: false };
}

export function TopBar() {
  const { status, alerts, connected, unread, toasts, dismissToast, markAllRead } = useMarketFeed();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const feed = feedLabel(status, connected);
  const ihsg = status?.ihsg ?? null;
  const BellIcon = unread > 0 ? BellRing : Bell;

  return (
    <>
      <div className="sticky top-0 z-[100] -mx-4 mb-6 bg-canvas px-4 py-3 md:-mx-8 md:px-8">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
            <div className="flex min-w-0 items-center gap-2 text-sm" role="status">
              {feed.bad ? (
                <WifiOff aria-hidden className="h-4 w-4 shrink-0 text-loss" />
              ) : (
                <Activity aria-hidden className="h-4 w-4 shrink-0 text-muted" />
              )}
              <span className="min-w-0">
                <span className={`text-base ${feed.bad ? "text-loss" : ""}`}>{feed.text}</span>
                {feed.sub && <span className="hidden text-muted lg:inline"> · {feed.sub}</span>}
              </span>
            </div>
            {ihsg && (
              <div className="font-mono text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
                <span className="text-muted">IHSG </span>
                {ihsg.price.toLocaleString("id-ID", { maximumFractionDigits: 2 })}{" "}
                <span className={ihsg.changePct > 0 ? "text-gain" : ihsg.changePct < 0 ? "text-loss" : "text-muted"}>
                  {signed(ihsg.changePct)}
                </span>
              </div>
            )}
          </div>

          <div ref={wrapRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = !open;
                setOpen(next);
                if (next) markAllRead();
              }}
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"}
              className="btn-ghost relative w-11 px-0"
            >
              <BellIcon aria-hidden className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-mono text-xs text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </button>

            {open && (
              <div
                id={panelId}
                className="panel absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] p-2"
                style={{ zIndex: 200 }}
              >
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <h2 className="text-xl">Notifikasi pasar</h2>
                  <span className="text-sm text-muted">Ambang: ±5%, ±10%, volume 3x</span>
                </div>
                {alerts.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-muted">
                    Belum ada alert. Alert muncul saat harga, volume, atau rating teknikal melewati ambang pada saham
                    dengan nilai transaksi di atas Rp 5 M.
                  </p>
                ) : (
                  <ul className="max-h-[60dvh] space-y-1 overflow-y-auto">
                    {alerts.map((a) => (
                      <AlertRow key={a.id} alert={a} />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-24 left-4 flex flex-col items-end gap-2 md:bottom-6"
        style={{ zIndex: 500 }}
      >
        {toasts.map((t) => (
          <div key={t.id} className="panel pointer-events-auto flex w-full max-w-sm items-start gap-3 p-3">
            <AlertIcon alert={t} />
            <div className="min-w-0 flex-1">
              <div className="text-base">{t.title}</div>
              <div className="text-sm text-muted">{t.detail}</div>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Tutup notifikasi"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ink/5"
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
