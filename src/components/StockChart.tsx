"use client";

import React from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { CopyCommand } from "./CopyCommand";

const FONT = "var(--font-jetbrains), monospace";

export function StockPriceChart({ data }: { data: { date: string; close: number }[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-center text-base text-muted">
        <p>Belum ada data harga untuk saham ini.</p>
        <code className="scribble border border-edge bg-highlight px-3 py-1.5 font-mono text-sm text-ink">
          npm run sync:market
        </code>
        <CopyCommand command="npm run sync:market" />
      </div>
    );
  }

  return (
    <div className="h-72 w-full" role="img" aria-label="Grafik harga penutupan 6 bulan terakhir">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#cfc8b8" strokeDasharray="4 4" />
          <XAxis dataKey="date" stroke="#5a564e" tick={{ fontSize: 12, fill: "#5a564e", fontFamily: FONT }} minTickGap={40} />
          <YAxis
            stroke="#5a564e"
            tick={{ fontSize: 12, fill: "#5a564e", fontFamily: FONT }}
            domain={["auto", "auto"]}
            width={64}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#fcfbf7",
              border: "1px solid #cfc8b8",
              borderRadius: 8,
              color: "#0e2a5c",
              fontSize: 14,
            }}
          />
          <Line type="monotone" dataKey="close" stroke="#1f2bc2" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
