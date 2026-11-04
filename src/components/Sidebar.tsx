"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartCandlestick,
  House,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  RefreshCw,
  Users,
} from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { ChatOpenProvider } from "./chat-context";
import { TopBar } from "./TopBar";

const NAV_ITEMS = [
  { href: "/", label: "Overview", short: "Home", Icon: House },
  { href: "/stocks", label: "Stocks", short: "Stocks", Icon: ChartCandlestick },
  { href: "/investors", label: "Investors", short: "Investor", Icon: Users },
  { href: "/sector-rotation", label: "Sector Rotation", short: "Sektor", Icon: RefreshCw },
  { href: "/bandar-detector", label: "Bandar Detector", short: "Bandar", Icon: Radar },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = useCallback(() => setChatOpen(true), []);

  return (
    <ChatOpenProvider value={openChat}>
      <div className="flex min-h-[100dvh] text-ink">
        <a
          href="#konten"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[300] focus:rounded-card focus:bg-card focus:px-4 focus:py-2 focus:text-lg focus:shadow-raised"
        >
          Lewati ke konten
        </a>
        <aside
          className={`spiral-edge sticky top-0 z-[100] hidden h-[100dvh] shrink-0 flex-col border-r border-edge bg-card py-5 pl-6 md:flex ${
            collapsed ? "w-[96px]" : "w-[256px]"
          }`}
        >
          <div className="flex items-center justify-between gap-2 pr-3 pb-6 pl-2">
            {!collapsed && (
              <Link href="/" className="text-2xl leading-none font-bold">
                Whale Tracker
              </Link>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
              aria-expanded={!collapsed}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ink/5 hover:text-ink"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
          </div>

          <nav aria-label="Navigasi utama" className="flex-1 space-y-1.5 pr-3">
            {NAV_ITEMS.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? label : undefined}
                  className={`scribble flex min-h-11 items-center gap-3 px-3 text-lg transition-colors duration-200 ${
                    active ? "bg-highlight text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden className={`h-5 w-5 shrink-0 ${active ? "text-accent" : ""}`} />
                  {!collapsed && <span className={active ? "underline decoration-accent decoration-wavy underline-offset-4" : ""}>{label}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="pr-3">
            <button type="button" onClick={openChat} aria-label="Buka asisten riset" className="btn w-full text-lg">
              <MessageSquare aria-hidden className="h-5 w-5 shrink-0" />
              {!collapsed && <span>Ask AI</span>}
            </button>
          </div>
        </aside>

        <main id="konten" className="min-w-0 flex-1 px-4 pt-0 pb-28 md:px-8 md:pb-12">
          <TopBar />
          <div key={pathname} className="fade mx-auto max-w-[1280px] space-y-6">
            {children}
          </div>
        </main>

        <nav
          aria-label="Navigasi utama"
          className="fixed inset-x-0 bottom-0 z-[100] grid grid-cols-6 gap-1 border-t border-edge bg-card px-1 pt-2"
          style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
          {NAV_ITEMS.map(({ href, short, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`scribble flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-sm md:hidden ${
                  active ? "bg-highlight text-ink" : "text-muted"
                }`}
              >
                <Icon aria-hidden className={`h-5 w-5 ${active ? "text-accent" : ""}`} />
                <span>{short}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openChat}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-control px-0.5 text-sm text-muted md:hidden"
          >
            <MessageSquare aria-hidden className="h-5 w-5" />
            <span>Ask AI</span>
          </button>
        </nav>

        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </ChatOpenProvider>
  );
}
