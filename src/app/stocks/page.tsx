import React from "react";
import Link from "next/link";
import { listStocks } from "@/db/queries";
import { EmptyState, PageHeader, Pagination, Panel, ScrollTable, SearchBox } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StocksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const { items, total, pageSize, period } = listStocks({ q, page, pageSize: 50 });

  return (
    <>
      <PageHeader
        title="Stocks"
        description="Emiten IDX dengan harga terakhir, pemegang terbesar, dan konsentrasi kepemilikan di atas 1%."
        meta={period ? `Periode data KSEI: ${period}` : undefined}
      />

      <SearchBox action="/stocks" defaultValue={q} label="Cari saham" placeholder="Kode atau nama emiten" />

      {total === 0 && !q ? (
        <EmptyState
          title="Belum ada data saham"
          hint="Impor berkas xlsx KSEI di atas 1%, lalu sinkronkan harga pasar."
          command="npm run sync:ownership"
        />
      ) : items.length === 0 ? (
        <EmptyState title="Saham tidak ditemukan" hint={`Tidak ada saham yang cocok dengan "${q}".`} />
      ) : (
        <Panel>
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Daftar saham</caption>
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Issuer</th>
                  <th scope="col">Sector</th>
                  <th scope="col" className="text-right">
                    Last Price
                  </th>
                  <th scope="col" className="text-right">
                    1D
                  </th>
                  <th scope="col">Largest Holder</th>
                  <th scope="col" className="text-right">
                    Concentration
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((st) => {
                  const chg = st.change_1d;
                  const chgClass = chg === null ? "text-muted" : chg > 0 ? "text-gain" : chg < 0 ? "text-loss" : "text-muted";
                  return (
                    <tr key={st.code}>
                      <td className="font-mono">
                        <Link href={`/stocks/${st.code}`} className="link">
                          {st.code}
                        </Link>
                      </td>
                      <td>{st.name}</td>
                      <td className="text-muted">{st.sector ?? "-"}</td>
                      <td className="num">
                        {st.last_price !== null ? `Rp ${st.last_price.toLocaleString("id-ID")}` : "-"}
                      </td>
                      <td className={`num ${chgClass}`}>
                        {chg === null ? "-" : `${chg > 0 ? "▲ +" : chg < 0 ? "▼ " : ""}${(chg * 100).toFixed(2)}%`}
                      </td>
                      <td>
                        {st.top_holder_name ? (
                          <>
                            {st.top_holder_name}{" "}
                            <span className="font-mono text-muted">({st.top_holder_pct?.toFixed(2)}%)</span>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="num font-medium">{st.concentration_pct.toFixed(2)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        </Panel>
      )}

      <Pagination basePath="/stocks" q={q} page={page} pageSize={pageSize} total={total} noun="saham" />
    </>
  );
}
