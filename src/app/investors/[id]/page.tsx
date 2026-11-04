import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getInvestor, investorHoldings, investorSectorAllocation } from "@/db/queries";
import { formatIdrShort } from "@/analytics/bandar";
import { OriginBadge, Panel, ScrollTable, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvestorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) notFound();

  const inv = getInvestor(numId);
  if (!inv) notFound();

  const holdings = investorHoldings(numId, inv.period);
  const sectors = investorSectorAllocation(numId, inv.period);
  const totalValue = holdings.reduce((acc, h) => acc + (h.value_idr ?? 0), 0);

  return (
    <>
      <Link href="/investors" className="link inline-flex min-h-11 items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Kembali ke Investors
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-bold break-words">{inv.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span>{inv.type}</span>
            <OriginBadge lf={inv.local_foreign} />
          </div>
        </div>
        <StatTile
          label="Total Portfolio Value"
          value={totalValue > 0 ? formatIdrShort(totalValue) : "-"}
          sub={`${holdings.length} saham dipegang`}
        />
      </header>

      {sectors.length > 0 && (
        <Panel title="Alokasi sektor" aside="Berdasarkan nilai pasar">
          <ul className="space-y-4 px-5 pt-2 pb-5">
            {sectors.map((s) => (
              <li key={s.sector} className="space-y-1.5 text-sm">
                <div className="flex flex-wrap justify-between gap-x-4">
                  <span>
                    {s.sector} <span className="text-muted">({s.stock_count} emiten)</span>
                  </span>
                  <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {s.weight_pct.toFixed(1)}%{s.value_idr > 0 ? ` · ${formatIdrShort(s.value_idr)}` : ""}
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full border border-edge bg-canvas">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(1, s.weight_pct))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Kepemilikan saham di atas 1%">
        <ScrollTable>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Kode</th>
                <th scope="col">Emiten</th>
                <th scope="col">Sektor</th>
                <th scope="col" className="text-right">
                  % Kepemilikan
                </th>
                <th scope="col" className="text-right">
                  Jumlah Saham
                </th>
                <th scope="col" className="text-right">
                  Nilai
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.code}>
                  <td className="font-mono">
                    <Link href={`/stocks/${h.code}`} className="link">
                      {h.code}
                    </Link>
                  </td>
                  <td>{h.issuer_name}</td>
                  <td className="text-muted">{h.sector ?? "-"}</td>
                  <td className="num">{h.pct.toFixed(2)}%</td>
                  <td className="num">{h.total_shares.toLocaleString("id-ID")}</td>
                  <td className="num">{h.value_idr !== null ? formatIdrShort(h.value_idr) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </Panel>
    </>
  );
}
