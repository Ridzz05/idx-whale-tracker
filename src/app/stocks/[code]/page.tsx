import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getStock, stockHolders, stockPriceSeries } from "@/db/queries";
import { formatIdrShort } from "@/analytics/bandar";
import { StockPriceChart } from "@/components/StockChart";
import { OriginBadge, Panel, ScrollTable, StatTile } from "@/components/ui";
import { signedPct } from "@/lib/format";
import { ensureFeed } from "@/market/feed";

export const dynamic = "force-dynamic";

export default async function StockDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const stock = getStock(code);
  if (!stock) notFound();

  const live = ensureFeed().quote(stock.code);

  const holders = stockHolders(stock.code, stock.period);
  const priceSeries = stockPriceSeries(stock.code).map((p) => ({ date: p.date, close: p.close }));
  const chg = stock.change_1d;

  return (
    <>
      <Link href="/stocks" className="link inline-flex min-h-11 items-center gap-1 text-sm">
        <ArrowLeft aria-hidden className="h-4 w-4" />
        Kembali ke Stocks
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,4vw,2.25rem)] leading-tight font-bold">
            <span className="font-mono">{stock.code}</span>
            <span className="ml-3 text-lg font-normal text-muted">{stock.name}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {stock.sector && <span>{stock.sector}</span>}
            {stock.industry && <span>{stock.industry}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-4">
          <StatTile
            label="Harga terakhir"
            value={stock.last_price !== null ? `Rp ${stock.last_price.toLocaleString("id-ID")}` : "-"}
            sub={
              chg === null ? undefined : `${chg > 0 ? "▲ +" : chg < 0 ? "▼ " : ""}${(chg * 100).toFixed(2)}% (1D)`
            }
          />
          <StatTile
            label="Konsentrasi di atas 1%"
            value={`${stock.concentration_pct.toFixed(2)}%`}
            sub={`${stock.holder_count} pemegang, asing ${stock.foreign_pct.toFixed(2)}%`}
          />
          {live && (
            <StatTile
              label="Harga live IDX"
              value={`Rp ${live.price.toLocaleString("id-ID")}`}
              sub={`${signedPct(live.changePct)} · ${live.idxTime ? live.idxTime.slice(11, 16) : "-"} WIB`}
            />
          )}
        </div>
      </header>

      <Panel title={`Harga penutupan 6 bulan terakhir (${stock.code})`}>
        <div className="px-3 pb-4">
          <StockPriceChart data={priceSeries} />
        </div>
      </Panel>

      <Panel title={`Pemegang saham di atas 1% (${holders.length})`}>
        <ScrollTable>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Investor</th>
                <th scope="col">Type</th>
                <th scope="col">Local / Foreign</th>
                <th scope="col" className="text-right">
                  Shares
                </th>
                <th scope="col" className="text-right">
                  Ownership
                </th>
                <th scope="col" className="text-right">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.investor_id}>
                  <td>
                    <Link href={`/investors/${h.investor_id}`} className="link">
                      {h.investor_name}
                    </Link>
                  </td>
                  <td className="text-muted">{h.type}</td>
                  <td>
                    <OriginBadge lf={h.local_foreign} />
                  </td>
                  <td className="num">{h.total_shares.toLocaleString("id-ID")}</td>
                  <td className="num font-medium">{h.pct.toFixed(2)}%</td>
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
