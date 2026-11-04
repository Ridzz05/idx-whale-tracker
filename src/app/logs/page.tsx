import React from "react";
import { apiHealth, recentApiLog, recentCaptureLog, recentJobLog } from "@/market/audit";
import { EmptyState, PageHeader, Panel, ScrollTable, StatTile } from "@/components/ui";

export const dynamic = "force-dynamic";

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Jakarta",
});

const dateFormat = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

function wib(iso: string): string {
  const d = new Date(iso);
  return `${dateFormat.format(d)} ${timeFormat.format(d).replace(/\./g, ":")}`;
}

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)} dtk` : `${Math.round(v)} ms`;
}

function lag(seconds: number | null): string {
  if (seconds === null) return "-";
  return seconds < 90 ? `${seconds} dtk` : `${Math.round(seconds / 60)} mnt`;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-w-[42ch] overflow-x-auto text-sm whitespace-pre-wrap text-muted">
      {typeof value === "string" ? value : JSON.stringify(value, null, 1)}
    </pre>
  );
}

export default async function LogsPage() {
  const health = apiHealth(24);
  const api = recentApiLog(80);
  const captures = recentCaptureLog(80);
  const jobs = recentJobLog(40);
  const lastCapture = captures[0];

  return (
    <>
      <PageHeader
        title="Logs"
        description={`Jejak panggilan ke endpoint IDX, tiap siklus capture, dan tiap job CLI. Jendela kesehatan ${health.windowHours} jam terakhir, dibaca dari tabel api_log, capture_log, dan job_log.`}
        meta={health.lastOkTs ? `Panggilan sukses terakhir: ${wib(health.lastOkTs)} WIB` : undefined}
      />

      <div className="flex flex-wrap gap-4">
        <StatTile
          label="Permintaan API"
          value={health.requests.toLocaleString("id-ID")}
          sub={health.errors > 0 ? `${health.errors} gagal` : "tanpa kegagalan"}
        />
        <StatTile
          label="Tingkat sukses"
          value={health.okPct === null ? "-" : `${health.okPct.toFixed(1)}%`}
          sub={health.lastErrorTs ? `gagal terakhir ${wib(health.lastErrorTs)}` : "belum ada kegagalan"}
        />
        <StatTile label="Latensi median" value={health.p50Ms === null ? "-" : ms(health.p50Ms)} sub="p50 semua endpoint" />
        <StatTile label="Latensi ekor" value={health.p95Ms === null ? "-" : ms(health.p95Ms)} sub="p95 semua endpoint" />
        <StatTile
          label="Capture terakhir"
          value={lastCapture ? `${lastCapture.quotes ?? 0}/${lastCapture.watchlist ?? 0}` : "-"}
          sub={lastCapture ? `${lastCapture.state} · ${wib(lastCapture.ts)}` : "belum pernah"}
        />
      </div>

      <Panel title="Kesehatan API" aside={`${health.endpoints.length} endpoint, ${health.windowHours} jam`}>
        {health.endpoints.length === 0 ? (
          <EmptyState
            title="Belum ada panggilan API tercatat"
            hint="Log terisi saat feed berjalan dan relay melayani permintaan ke IDX."
            command="npm run dev"
          />
        ) : (
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Kesehatan per endpoint IDX</caption>
              <thead>
                <tr>
                  <th scope="col">Endpoint</th>
                  <th scope="col" className="text-right">Permintaan</th>
                  <th scope="col" className="text-right">Gagal</th>
                  <th scope="col" className="text-right">p50</th>
                  <th scope="col" className="text-right">p95</th>
                  <th scope="col">Terakhir</th>
                  <th scope="col">Galat terakhir</th>
                </tr>
              </thead>
              <tbody>
                {health.endpoints.map((e) => (
                  <tr key={e.endpoint}>
                    <td className="font-mono">{e.endpoint}</td>
                    <td className="num">{e.requests.toLocaleString("id-ID")}</td>
                    <td className={`num ${e.errors > 0 ? "text-loss font-bold" : "text-muted"}`}>{e.errors}</td>
                    <td className="num">{ms(e.p50_ms)}</td>
                    <td className="num">{ms(e.p95_ms)}</td>
                    <td className="whitespace-nowrap text-muted">{wib(e.last_ts)}</td>
                    <td className="text-muted">
                      <Json value={e.last_error ?? "-"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Panel>

      <Panel title="Log API" aside="80 permintaan terbaru, terbaru di atas">
        {api.length === 0 ? (
          <p className="px-5 pb-5 text-base text-muted">Belum ada baris log.</p>
        ) : (
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Riwayat permintaan ke endpoint IDX</caption>
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Durasi</th>
                  <th scope="col" className="text-right">Baris</th>
                  <th scope="col">Pesan</th>
                </tr>
              </thead>
              <tbody>
                {api.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono whitespace-nowrap">{wib(r.ts)}</td>
                    <td className="font-mono">{r.endpoint}</td>
                    <td className={r.ok === 1 ? "text-gain" : "text-loss font-bold"}>
                      {r.status ?? (r.ok === 1 ? "ok" : "gagal")}
                    </td>
                    <td className="num">{ms(r.duration_ms)}</td>
                    <td className="num">{r.rows ?? "-"}</td>
                    <td className="text-muted">
                      <Json value={r.message ?? ""} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Panel>

      <Panel title="Log capture IDX" aside="Satu baris per siklus poller">
        {captures.length === 0 ? (
          <EmptyState
            title="Belum ada siklus capture tercatat"
            hint="Poller mencatat siklus saat aplikasi berjalan dan relay tersambung ke tab IDX."
            command="npm run dev"
          />
        ) : (
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Riwayat siklus capture data IDX</caption>
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Watchlist</th>
                  <th scope="col" className="text-right">Kutipan</th>
                  <th scope="col" className="text-right">Selisih data</th>
                  <th scope="col" className="text-right">Durasi</th>
                  <th scope="col">Pesan</th>
                </tr>
              </thead>
              <tbody>
                {captures.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono whitespace-nowrap">{wib(r.ts)}</td>
                    <td className={r.state === "ok" ? "text-gain" : "text-loss font-bold"}>{r.state}</td>
                    <td className="num">{r.watchlist ?? "-"}</td>
                    <td className="num">{r.quotes ?? "-"}</td>
                    <td className="num">{lag(r.lag_seconds)}</td>
                    <td className="num">{r.duration_ms === null ? "-" : ms(r.duration_ms)}</td>
                    <td className="text-muted">
                      <Json value={r.message ?? ""} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Panel>

      <Panel title="Log job" aside="Satu baris per job CLI: sync, scan, dan index">
        {jobs.length === 0 ? (
          <EmptyState
            title="Belum ada job yang tercatat"
            hint="Job menulis satu baris saat selesai, lewat npm run sync:market, sync:ownership, scan:bandar, atau index:rag."
            command="npm run scan:bandar"
          />
        ) : (
          <ScrollTable>
            <table className="data-table">
              <caption className="sr-only">Riwayat job CLI beserta ringkasannya</caption>
              <thead>
                <tr>
                  <th scope="col">Waktu</th>
                  <th scope="col">Job</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="text-right">Durasi</th>
                  <th scope="col">Ringkasan</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono whitespace-nowrap">{wib(r.ts)}</td>
                    <td className="font-mono">{r.job}</td>
                    <td className={r.state === "ok" ? "text-gain" : "text-loss font-bold"}>{r.state}</td>
                    <td className="num">{ms(r.duration_ms)}</td>
                    <td className="text-muted">
                      <Json value={r.message && r.state === "error" ? r.message : (r.summary ?? "")} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Panel>
    </>
  );
}
