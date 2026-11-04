import React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { overviewStats } from "@/db/queries";
import { ensureFeed } from "@/market/feed";
import { signedPct } from "@/lib/format";
import { ArrowDoodle, CoffeeRing, WhaleDoodle } from "@/components/Doodles";
import { AskButton } from "@/components/chat-context";
import { EmptyState, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("id-ID");

function stagger(i: number): React.CSSProperties {
  return { "--i": i } as React.CSSProperties;
}

export default function OverviewPage() {
  const s = overviewStats();
  const feed = ensureFeed().status();
  const hasData = s.period !== null;

  if (!hasData) {
    return (
      <EmptyState
        title="Belum ada data kepemilikan"
        hint="Impor berkas xlsx KSEI di atas 1% untuk mengisi ringkasan, lalu sinkronkan harga pasar."
        command="npm run sync:ownership"
      />
    );
  }

  const dataStamp = feed.idxDataTime ? `Data IDX ${feed.idxDataTime.slice(0, 10)} ${feed.idxDataTime.slice(11, 16)} WIB` : null;

  const spokes = [
    {
      href: "/investors",
      title: "Investors",
      stat: nf.format(s.investorCount),
      unit: "investor",
      text: `Pemegang di atas 1% dengan ${nf.format(s.holdingCount)} posisi. Buka satu investor untuk melihat portofolio dan alokasi sektornya.`,
      span: "lg:col-span-7",
      tilt: "-rotate-[0.4deg]",
    },
    {
      href: "/stocks",
      title: "Stocks",
      stat: nf.format(s.stockCount),
      unit: "emiten",
      text: `${nf.format(s.pricedStockCount)} di antaranya punya data harga terakhir ${s.lastPriceDate ?? "-"}.`,
      span: "lg:col-span-5",
      tilt: "rotate-[0.5deg]",
    },
    {
      href: "/sector-rotation",
      title: "Sector Rotation",
      stat: nf.format(s.sectorCount),
      unit: "sektor",
      text: "Median return per sektor untuk 5, 21, dan 63 sesi, dibanding IHSG.",
      span: "lg:col-span-5",
      tilt: "rotate-[0.3deg]",
    },
    {
      href: "/bandar-detector",
      title: "Bandar Detector",
      stat: s.bandarScanDate ? `${s.accumulationCount} / ${s.distributionCount}` : "-",
      unit: "akumulasi / distribusi",
      text: s.bandarScanDate
        ? `Scan ${s.bandarScanDate}. Proksi harga-volume, bukan data broker.`
        : "Belum ada hasil scan. Jalankan npm run scan:bandar.",
      span: "lg:col-span-7",
      tilt: "-rotate-[0.3deg]",
    },
  ];

  return (
    <>
      <section className="relative grid items-center gap-8 py-4 lg:grid-cols-12">
        <CoffeeRing aria-hidden className="pointer-events-none absolute -top-8 right-1/3 hidden h-32 w-32 lg:block" />
        <div className="rise lg:col-span-7" style={stagger(0)}>
          <p className="text-lg text-muted">Catatan riset saham Indonesia</p>
          <h1 className="mt-1 text-[clamp(2.5rem,5vw,4rem)] leading-[1.05] font-bold">
            Siapa yang memegang saham di atas 1%, dan ke mana uangnya bergerak?
          </h1>
          <p className="mt-4 max-w-[60ch] text-lg text-muted">
            Kepemilikan {nf.format(s.stockCount)} emiten oleh {nf.format(s.investorCount)} investor, dari data bulanan
            KSEI. Harga, rotasi sektor, dan alert pasar berjalan di atasnya.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href="/investors" className="btn text-lg">
              Lihat investor
              <ArrowRight aria-hidden className="h-5 w-5" />
            </Link>
            <AskButton>Tanya asisten riset</AskButton>
          </div>
        </div>

        <div className="rise relative lg:col-span-5" style={stagger(2)}>
          <div className="panel tape scribble rotate-[1.2deg] p-6">
            <WhaleDoodle className="mx-auto h-auto w-full max-w-[320px]" />
            <ArrowDoodle className="absolute -bottom-4 -left-6 hidden h-12 w-24 -rotate-12 lg:block" />
          </div>
        </div>
      </section>

      <section aria-labelledby="peta-data" className="space-y-4">
        <h2 id="peta-data" className="text-[clamp(1.5rem,3vw,2.25rem)] font-bold">
          Peta data
        </h2>
        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {spokes.map((sp, i) => (
            <li key={sp.href} className={`rise ${sp.span}`} style={stagger(i + 1)}>
              <Link
                href={sp.href}
                className={`panel scribble flex h-full flex-col gap-2 p-6 transition-transform duration-200 hover:rotate-0 hover:-translate-y-0.5 ${sp.tilt}`}
              >
                <span className="text-xl">{sp.title}</span>
                <span className="font-mono text-[clamp(1.75rem,3vw,2.5rem)] leading-none font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {sp.stat}
                </span>
                <span className="text-base text-muted">{sp.unit}</span>
                <span className="mt-1 max-w-[56ch] text-base">{sp.text}</span>
                <span className="mt-auto inline-flex items-center gap-1 pt-3 text-accent">
                  Buka {sp.title}
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid items-start gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel
            title="Penggerak pasar"
            aside={dataStamp ?? (feed.state === "error" ? "Capture terputus" : "Menunggu data pertama")}
          >
            {feed.gainers.length === 0 && feed.losers.length === 0 ? (
              <p className="px-5 pt-1 pb-5 text-base text-muted">
                {feed.state === "error"
                  ? `Feed pasar sedang terputus: ${feed.error ?? "tanpa keterangan"}.`
                  : "Feed pasar belum menerima data pertama. Muat ulang beberapa detik lagi."}
              </p>
            ) : (
              <div className="grid gap-x-6 px-5 pb-5 sm:grid-cols-2">
                {[
                  { label: "Naik terbesar", rows: feed.gainers },
                  { label: "Turun terbesar", rows: feed.losers },
                ].map(({ label, rows }) => (
                  <div key={label}>
                    <h3 className="py-2 text-lg text-muted">{label}</h3>
                    <ul className="divide-y divide-dashed divide-edge">
                      {rows.map((m) => (
                        <li key={m.code}>
                          <Link href={`/stocks/${m.code}`} className="flex min-h-11 items-center justify-between gap-3 hover:bg-highlight/60">
                            <span className="font-mono">{m.code}</span>
                            <span
                              className={`font-mono ${m.changePct > 0 ? "text-gain" : "text-loss"}`}
                              style={{ fontVariantNumeric: "tabular-nums" }}
                            >
                              {signedPct(m.changePct)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="note scribble p-5 lg:col-span-5">
          <h2 className="text-xl font-bold">Catatan sumber data</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-base">
            <li>Kepemilikan di atas 1% dirilis bulanan. Periode terbaru di sini: {s.period}.</li>
            <li>Harga dan alert ditangkap dari situs IDX lewat browser relay. Waktu data IDX ditampilkan di bilah atas.</li>
            <li>Bandar Detector menghitung dari harga dan volume, bukan dari data broker.</li>
            <li>Untuk riset pribadi, bukan rekomendasi investasi.</li>
          </ul>
        </aside>
      </section>
    </>
  );
}
