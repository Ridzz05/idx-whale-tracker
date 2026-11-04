"use client";

import React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from "recharts";

const FONT = "var(--font-jetbrains), monospace";

export function SectorReturnChart({ data }: { data: { sector: string; ret21dPct: number }[] }) {
  if (data.length === 0) return null;

  return (
    <div
      className="w-full"
      style={{ height: Math.max(260, data.length * 32 + 40) }}
      role="img"
      aria-label="Return 21 sesi per sektor"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke="#cfc8b8" strokeDasharray="4 4" horizontal={false} />
          <XAxis type="number" stroke="#5a564e" tick={{ fontSize: 12, fill: "#5a564e", fontFamily: FONT }} unit="%" />
          <YAxis
            type="category"
            dataKey="sector"
            stroke="#5a564e"
            tick={{ fontSize: 14, fill: "#0e2a5c" }}
            width={150}
          />
          <Tooltip
            formatter={(val: unknown) => [`${typeof val === "number" ? val.toFixed(2) : String(val)}%`, "Return 21 sesi"]}
            contentStyle={{
              backgroundColor: "#fcfbf7",
              border: "1px solid #cfc8b8",
              borderRadius: 8,
              color: "#0e2a5c",
              fontSize: 14,
            }}
          />
          <Bar dataKey="ret21dPct" isAnimationActive={false} radius={3}>
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.ret21dPct >= 0 ? "#1b6b3a" : "#b42318"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
