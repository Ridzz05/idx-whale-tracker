import React from "react";
import Link from "next/link";
import { listInvestors } from "@/db/queries";
import { EmptyState, OriginBadge, PageHeader, Pagination, Panel, ScrollTable, SearchBox } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const { items, total, pageSize, period } = listInvestors({ q, page, pageSize: 50 });

  return (
    <>
      <PageHeader
        title="Investors"
        description="Pemegang saham di atas 1% di bursa efek Indonesia, dari data bulanan KSEI."
      />

      <SearchBox action="/investors" defaultValue={q} label="Cari investor" placeholder="Nama investor" />

      {!period ? (
        <EmptyState
          title="Belum ada data kepemilikan"
          hint="Impor berkas xlsx KSEI di atas 1% untuk mengisi daftar investor."
          command="npm run sync:ownership"
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Investor tidak ditemukan"
          hint={`Tidak ada investor yang cocok dengan "${q}". Coba sebagian nama saja.`}
        />
      ) : (
        <Panel>
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Daftar investor</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Local / Foreign</th>
                  <th scope="col" className="text-right">
                    Stocks Held
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/investors/${inv.id}`} className="link">
                        {inv.name}
                      </Link>
                    </td>
                    <td className="text-muted">{inv.type}</td>
                    <td>
                      <OriginBadge lf={inv.local_foreign} />
                    </td>
                    <td className="num">{inv.stocks_held}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        </Panel>
      )}

      <Pagination basePath="/investors" q={q} page={page} pageSize={pageSize} total={total} noun="investor" />
    </>
  );
}
