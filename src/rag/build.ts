import { getDb } from "@/db/client";
import {
  latestPeriod,
  sectorRotation,
  latestBandarScan,
} from "@/db/queries";
import { formatIdrShort } from "@/analytics/bandar";

export interface BuildDocsSummary {
  period: string | null;
  stockDocs: number;
  investorDocs: number;
  bandarDocs: number;
  sectorDocs: number;
  totalSystemDocs: number;
}

export function buildDocs(): BuildDocsSummary {
  const db = getDb();
  const period = latestPeriod();
  const p = period ?? "";
  const nowIso = new Date().toISOString();

  const upsertDoc = db.prepare(`
    INSERT INTO docs (kind, ref, title, body, source_url, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
    ON CONFLICT(kind, ref) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      created_at = excluded.created_at
  `);

  const stocks = db
    .prepare(`SELECT code, name, sector, industry, last_price FROM stocks ORDER BY code ASC`)
    .all() as {
    code: string;
    name: string;
    sector: string | null;
    industry: string | null;
    last_price: number | null;
  }[];

  const holdersStmt = db.prepare(`
    SELECT i.name, i.type, i.local_foreign, h.pct, h.total_shares
    FROM holdings h
    JOIN investors i ON i.id = h.investor_id
    WHERE h.code = ? AND h.period = ?
    ORDER BY h.pct DESC
    LIMIT 10
  `);

  const investors = db
    .prepare(`SELECT id, name, type, local_foreign FROM investors ORDER BY id ASC`)
    .all() as {
    id: number;
    name: string;
    type: string;
    local_foreign: "L" | "F";
  }[];

  const invHoldingsStmt = db.prepare(`
    SELECT h.code, s.name AS issuer_name, s.sector, s.last_price, h.pct, h.total_shares
    FROM holdings h
    JOIN stocks s ON s.code = h.code
    WHERE h.investor_id = ? AND h.period = ?
    ORDER BY h.pct DESC
  `);

  const bandar = latestBandarScan({ limit: 1000 });
  const rotation = sectorRotation();

  let stockDocs = 0;
  let investorDocs = 0;
  let bandarDocs = 0;
  let sectorDocs = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM docs WHERE kind IN ('stock','investor','bandar','sector')`).run();

    for (const s of stocks) {
      const holders = holdersStmt.all(s.code, p) as {
        name: string;
        type: string;
        local_foreign: string;
        pct: number;
        total_shares: number;
      }[];
      const holderLines = holders.map(
        (h, idx) =>
          `${idx + 1}. ${h.name} (${h.type}, ${h.local_foreign === "L" ? "Lokal" : "Asing"}): ${h.pct.toFixed(2)}% (${h.total_shares.toLocaleString("id-ID")} lembar)`
      );
      const priceText =
        s.last_price !== null ? `Rp ${s.last_price.toLocaleString("id-ID")}` : "belum tersedia";
      const title = `Saham ${s.code} — ${s.name}`;
      const body = [
        `Emiten: ${s.code} (${s.name})`,
        `Sektor: ${s.sector ?? "Belum terklasifikasi"} | Industri: ${s.industry ?? "-"}`,
        `Harga terakhir: ${priceText} | Periode data kepemilikan: ${period ?? "-"}`,
        `Pemegang saham >1% teratas (${holders.length}):`,
        ...(holderLines.length > 0 ? holderLines : ["Tidak ada data pemegang >1%"]),
      ].join("\n");

      upsertDoc.run("stock", `stock:${s.code}`, title, body, nowIso);
      stockDocs += 1;
    }

    for (const inv of investors) {
      const hs = invHoldingsStmt.all(inv.id, p) as {
        code: string;
        issuer_name: string;
        sector: string | null;
        last_price: number | null;
        pct: number;
        total_shares: number;
      }[];
      let totalVal = 0;
      const hLines = hs.map((h) => {
        const val = h.last_price !== null ? h.total_shares * h.last_price : 0;
        totalVal += val;
        return `- ${h.code} (${h.issuer_name}): ${h.pct.toFixed(2)}% (${h.total_shares.toLocaleString("id-ID")} lembar${val > 0 ? `, nilai ${formatIdrShort(val)}` : ""})`;
      });
      const title = `Investor ${inv.name} (${inv.type}, ${inv.local_foreign === "L" ? "Local" : "Foreign"})`;
      const body = [
        `Investor: ${inv.name}`,
        `Tipe: ${inv.type} | Status: ${inv.local_foreign === "L" ? "Local (Lokal)" : "Foreign (Asing)"}`,
        `Jumlah saham dipegang (>1%): ${hs.length} emiten | Periode: ${period ?? "-"}`,
        `Total estimasi nilai portofolio: ${totalVal > 0 ? formatIdrShort(totalVal) : "harga belum tersedia"}`,
        `Daftar kepemilikan:`,
        ...hLines,
      ].join("\n");

      upsertDoc.run("investor", `investor:${inv.id}`, title, body, nowIso);
      investorDocs += 1;
    }

    if (bandar.scanDate) {
      for (const b of bandar.items) {
        const title = `Bandar Detector ${b.code} (${b.signal.toUpperCase()}) — Skor ${b.score}`;
        const body = [
          `Tanggal scan: ${bandar.scanDate}`,
          `Saham: ${b.code} (${b.name}) | Sektor: ${b.sector ?? "-"}`,
          `Sinyal: ${b.signal} | Skor: ${b.score}/100`,
          `Penjelasan: ${b.explanation}`,
        ].join("\n");
        upsertDoc.run(
          "bandar",
          `bandar:${bandar.scanDate}:${b.code}`,
          title,
          body,
          nowIso
        );
        bandarDocs += 1;
      }
    }

    for (const sec of rotation.sectors) {
      const fmtPct = (v: number | null) =>
        v === null ? "-" : `${(v * 100).toFixed(2)}%`;
      const topList = sec.topStocks
        .map((t) => `${t.code} (${(t.ret21d * 100).toFixed(2)}%)`)
        .join(", ");
      const title = `Rotasi Sektor ${sec.sector}`;
      const body = [
        `Sektor: ${sec.sector} (${sec.stockCount} emiten)`,
        `Return 5 hari: ${fmtPct(sec.ret5d)} | 21 hari: ${fmtPct(sec.ret21d)} | 63 hari: ${fmtPct(sec.ret63d)}`,
        `Relatif terhadap IHSG (21 hari): ${fmtPct(sec.rel21d)}`,
        `Saham penggerak 21 hari teratas: ${topList || "-"}`,
      ].join("\n");
      upsertDoc.run("sector", `sector:${sec.sector}`, title, body, nowIso);
      sectorDocs += 1;
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return {
    period,
    stockDocs,
    investorDocs,
    bandarDocs,
    sectorDocs,
    totalSystemDocs: stockDocs + investorDocs + bandarDocs + sectorDocs,
  };
}
