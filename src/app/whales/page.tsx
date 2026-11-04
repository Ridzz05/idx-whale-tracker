import React from "react";
import Link from "next/link";
import {
  holdingPeriods,
  periodAgeDays,
  whaleDeltas,
  type WhaleDeltaRow,
} from "@/db/queries";
import { formatIdrShort } from "@/analytics/bandar";
import { EmptyState, PageHeader, Panel, ScrollTable, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;
const STALE_DAYS = 45;

const STATUS_LABEL: Record<WhaleDeltaRow["status"], string> = {
  up: "Tambah",
  down: "Kurangi",
  new: "Masuk baru",
  exit: "Keluar <1%",
};

function pct(n: number): string {
  const v = n.toFixed(2).replace(".", ",");
  return `${n > 0 ? "+" : ""}${v} pp`;
}

function shares(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2).replace(".", ",")} M`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(".", ",")} Jt`;
  return `${sign}${abs.toLocaleString("id-ID")}`;
}

function tone(status: WhaleDeltaRow["status"]): string {
  return status === "down" || status === "exit" ? "text-loss" : "text-gain";
}

export default async function WhalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const periods = holdingPeriods();

  if (periods.length < 2) {
    return (
      <>
        <PageHeader
          title="Whale Flow"
          description="Perubahan kepemilikan pemegang saham di atas 1% antar periode KSEI."
        />
        <EmptyState
          title="Butuh minimal dua periode"
          hint={
            periods.length === 0
              ? "Belum ada data kepemilikan. Impor berkas xlsx KSEI lebih dulu."
              : `Baru ada satu periode (${periods[0].period}). Perubahan hanya bisa dihitung setelah periode berikutnya masuk.`
          }
          command="npm run sync:ownership"
        />
      </>
    );
  }

  const codes = periods.map((p) => p.period);
  const to = sp.to && codes.includes(sp.to) ? sp.to : codes[0];
  const toIdx = codes.indexOf(to);
  const from = sp.from && codes.includes(sp.from) && sp.from !== to ? sp.from : codes[toIdx + 1] ?? codes[1];
  const status = (["up", "down", "new", "exit"] as const).find((s) => s === sp.status) ?? null;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);

  const deltas = whaleDeltas(from, to);
  const filtered = status ? deltas.filter((d) => d.status === status) : deltas;
  const sorted = [...filtered].sort(
    (a, b) => Math.abs(b.delta_value_idr ?? 0) - Math.abs(a.delta_value_idr ?? 0) || b.delta_shares - a.delta_shares
  );
  const shown = sorted.slice(0, PAGE_SIZE * page);
  const age = periodAgeDays(to);
  const stale = age > STALE_DAYS;

  const count = (s: WhaleDeltaRow["status"]) => deltas.filter((d) => d.status === s).length;
  const inflow = deltas.reduce((acc, d) => acc + Math.max(0, d.delta_value_idr ?? 0), 0);
  const outflow = deltas.reduce((acc, d) => acc + Math.min(0, d.delta_value_idr ?? 0), 0);

  const href = (opts: { status?: string | null; page?: number; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    q.set("from", opts.from ?? from);
    q.set("to", opts.to ?? to);
    const s = opts.status === undefined ? status : opts.status;
    if (s) q.set("status", s);
    if ((opts.page ?? 1) > 1) q.set("page", String(opts.page ?? 1));
    return `/whales?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Whale Flow"
        description="Perubahan kepemilikan pemegang saham di atas 1% antar dua periode KSEI. Rilis bulanan dengan jeda publikasi, jadi ini konteks posisi, bukan sinyal intraday."
        meta={
          <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
            {from} → {to}
          </span>
        }
      />

      <div className="flex flex-wrap gap-4">
        <StatTile label="Posisi berubah" value={deltas.length.toLocaleString("id-ID")} sub="pasangan investor–saham" />
        <StatTile label="Masuk baru" value={count("new").toLocaleString("id-ID")} sub="menembus 1%" />
        <StatTile label="Keluar" value={count("exit").toLocaleString("id-ID")} sub="turun di bawah 1%" />
        <StatTile label="Estimasi masuk" value={formatIdrShort(inflow)} sub="nilai tambahan" />
        <StatTile label="Estimasi keluar" value={formatIdrShort(outflow)} sub="nilai pengurangan" />
      </div>

      {stale && (
        <p className="panel px-5 py-4 text-base">
          Periode terakhir <span className="font-mono">{to}</span> berumur {age} hari. Rilis KSEI biasanya muncul
          3–4 minggu setelah tanggal periode, dan pernah sampai 56 hari. Angka di halaman ini masih memakai rilis
          terakhir yang tersedia.
        </p>
      )}

      <Panel
        title="Perubahan kepemilikan"
        aside={`${filtered.length.toLocaleString("id-ID")} baris, diurutkan menurut nilai`}
      >
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <Link
            href={href({ status: null, page: 1 })}
            aria-current={status === null ? "page" : undefined}
            className={`btn-ghost text-sm ${status === null ? "bg-highlight" : ""}`}
          >
            Semua
          </Link>
          {(["up", "down", "new", "exit"] as const).map((s) => (
            <Link
              key={s}
              href={href({ status: s, page: 1 })}
              aria-current={status === s ? "page" : undefined}
              className={`btn-ghost text-sm ${status === s ? "bg-highlight" : ""}`}
            >
              {STATUS_LABEL[s]} ({count(s)})
            </Link>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="px-5 pb-5 text-base text-muted">Tidak ada perubahan pada filter ini.</p>
        ) : (
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Perubahan kepemilikan antar periode</caption>
              <thead>
                <tr>
                  <th scope="col">Saham</th>
                  <th scope="col">Investor</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Lembar</th>
                  <th scope="col" className="text-right">Porsi</th>
                  <th scope="col" className="text-right">Nilai</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={`${d.code}-${d.investor_id}`}>
                    <td className="font-mono whitespace-nowrap">
                      <Link href={`/stocks/${d.code}`} className="link">
                        {d.code}
                      </Link>
                    </td>
                    <td className="min-w-[14rem]">
                      <span className="block">{d.investor_name}</span>
                      <span className="block text-sm text-muted">
                        {d.local_foreign === "F" ? "Asing" : "Lokal"} · {d.investor_type}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap ${tone(d.status)}`}>{STATUS_LABEL[d.status]}</td>
                    <td className={`num whitespace-nowrap ${tone(d.status)}`}>{shares(d.delta_shares)}</td>
                    <td className={`num whitespace-nowrap ${tone(d.status)}`}>{pct(d.delta_pct)}</td>
                    <td className="num whitespace-nowrap">
                      {d.delta_value_idr === null ? "-" : formatIdrShort(d.delta_value_idr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}

        {sorted.length > shown.length && (
          <div className="flex items-center justify-between px-5 py-4 text-base text-muted">
            <span>
              {shown.length} dari {sorted.length.toLocaleString("id-ID")} baris
            </span>
            <Link href={href({ page: page + 1 })} className="btn-ghost">
              Muat lebih banyak
            </Link>
          </div>
        )}
      </Panel>

      <Panel title="Periode tersedia" aside="Dari tabel holdings">
        <ScrollTable>
          <table className="data-table">
            <caption className="sr-only">Periode KSEI yang tersimpan</caption>
            <thead>
              <tr>
                <th scope="col">Periode</th>
                <th scope="col" className="text-right">Baris kepemilikan</th>
                <th scope="col" className="text-right">Saham</th>
                <th scope="col" className="text-right">Investor</th>
                <th scope="col" className="text-right">Umur</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.period}>
                  <td className="font-mono whitespace-nowrap">{p.period}</td>
                  <td className="num">{p.holdings.toLocaleString("id-ID")}</td>
                  <td className="num">{p.stocks.toLocaleString("id-ID")}</td>
                  <td className="num">{p.investors.toLocaleString("id-ID")}</td>
                  <td className="num">{periodAgeDays(p.period)} hari</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      </Panel>
    </>
  );
}
