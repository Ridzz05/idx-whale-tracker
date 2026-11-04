import React from "react";
import { sectorRotation } from "@/db/queries";
import { SectorReturnChart } from "@/components/SectorChart";
import { EmptyState, PageHeader, Panel, ScrollTable } from "@/components/ui";

export const dynamic = "force-dynamic";

function fmtPct(v: number | null): string {
  if (v === null) return "-";
  const pct = v * 100;
  return `${pct > 0 ? "▲ +" : pct < 0 ? "▼ " : ""}${pct.toFixed(2)}%`;
}

function tone(v: number | null): string {
  if (v === null || v === 0) return "text-muted";
  return v > 0 ? "text-gain" : "text-loss";
}

export default async function SectorRotationPage() {
  const { ihsg, sectors } = sectorRotation();
  const chartData = sectors
    .filter((s) => s.ret21d !== null)
    .map((s) => ({ sector: s.sector, ret21dPct: Number(((s.ret21d ?? 0) * 100).toFixed(2)) }));

  return (
    <>
      <PageHeader
        title="Sector Rotation"
        description="Median return per sektor untuk 5, 21, dan 63 sesi bursa, dibandingkan dengan IHSG. Median dipakai supaya satu saham ekstrem tidak menggeser angka sektor."
        meta={
          <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
            IHSG{" "}
            <span className={tone(ihsg.ret5d)}>5D {fmtPct(ihsg.ret5d)}</span>
            {" · "}
            <span className={tone(ihsg.ret21d)}>21D {fmtPct(ihsg.ret21d)}</span>
            {" · "}
            <span className={tone(ihsg.ret63d)}>63D {fmtPct(ihsg.ret63d)}</span>
          </span>
        }
      />

      {sectors.length === 0 ? (
        <EmptyState
          title="Belum ada data harga per sektor"
          hint="Tarik riwayat harga dan klasifikasi sektor langsung dari IDX lewat browser relay."
          command="npm run sync:market"
        />
      ) : (
        <>
          <Panel title="Sektor mana yang unggul dalam 21 sesi terakhir?">
            <div className="px-3 pb-4">
              <SectorReturnChart data={chartData} />
            </div>
          </Panel>

          <Panel title="Detail per sektor">
            <ScrollTable>
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Sector</th>
                    <th scope="col" className="text-right">
                      5D
                    </th>
                    <th scope="col" className="text-right">
                      21D
                    </th>
                    <th scope="col" className="text-right">
                      63D
                    </th>
                    <th scope="col" className="text-right">
                      21D vs IHSG
                    </th>
                    <th scope="col" className="text-right">
                      Issuers
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((s) => (
                    <tr key={s.sector}>
                      <td className="font-medium">{s.sector}</td>
                      <td className={`num ${tone(s.ret5d)}`}>{fmtPct(s.ret5d)}</td>
                      <td className={`num font-bold ${tone(s.ret21d)}`}>{fmtPct(s.ret21d)}</td>
                      <td className={`num ${tone(s.ret63d)}`}>{fmtPct(s.ret63d)}</td>
                      <td className={`num ${tone(s.rel21d)}`}>{fmtPct(s.rel21d)}</td>
                      <td className="num">{s.stockCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollTable>
          </Panel>
        </>
      )}
    </>
  );
}
