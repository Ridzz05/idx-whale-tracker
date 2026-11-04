import React from "react";
import Link from "next/link";
import { latestBandarScan, type BandarScanRow } from "@/db/queries";
import { formatIdrShort } from "@/analytics/bandar";
import { EmptyState, PageHeader, Panel, ScrollTable } from "@/components/ui";

export const dynamic = "force-dynamic";

function SignalTable({ rows, tone }: { rows: BandarScanRow[]; tone: "text-gain" | "text-loss" }) {
  return (
    <ScrollTable>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col" className="text-right">
              Score
            </th>
            <th scope="col" className="text-right">
              7D net flow
            </th>
            <th scope="col">Explanation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td className="font-mono">
                <Link href={`/stocks/${row.code}`} className="link">
                  {row.code}
                </Link>
              </td>
              <td className="num font-bold">{row.score}</td>
              <td className={`num whitespace-nowrap ${tone}`}>{formatIdrShort(row.net_flow_7d)}</td>
              <td className="min-w-[16rem] text-muted">{row.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

export default async function BandarDetectorPage() {
  const { scanDate, items } = latestBandarScan({ limit: 500 });
  const acc = items
    .filter((i) => i.signal === "accumulation")
    .sort((a, b) => b.score - a.score || b.net_flow_7d - a.net_flow_7d);
  const dist = items
    .filter((i) => i.signal === "distribution")
    .sort((a, b) => a.score - b.score || a.net_flow_7d - b.net_flow_7d);

  return (
    <>
      <PageHeader
        title="Bandar Detector"
        description="Proksi berbasis harga-volume, bukan data broker. Dihitung dari Chaikin Money Flow 20 sesi dan arus bersih 7 hari untuk saham dengan nilai transaksi rata-rata di atas Rp 1 M per hari."
        meta={scanDate ? `Scan terbaru: ${scanDate}` : undefined}
      />

      {!scanDate || items.length === 0 ? (
        <EmptyState
          title="Belum ada hasil scan"
          hint="Sinkronkan harga pasar lebih dulu, lalu jalankan scan."
          command="npm run scan:bandar"
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel title={`Accumulation (${acc.length})`} aside="Skor 65 ke atas, arus 7 hari positif">
            <SignalTable rows={acc} tone="text-gain" />
          </Panel>
          <Panel title={`Distribution (${dist.length})`} aside="Skor 35 ke bawah, arus 7 hari negatif">
            <SignalTable rows={dist} tone="text-loss" />
          </Panel>
        </div>
      )}
    </>
  );
}
