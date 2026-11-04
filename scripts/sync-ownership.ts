import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/db/client";
import { importOwnershipXlsx, parseOwnershipXlsx } from "@/ingest/ownership";
import { fetchLatestFromIdx } from "@/ingest/idx-fetch";

async function main() {
  const args = process.argv.slice(2);
  let fileArg: string | null = null;
  let headless = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      fileArg = args[i + 1];
      i++;
    } else if (args[i] === "--headless") {
      headless = true;
    }
  }

  if (fileArg) {
    const resolved = path.resolve(process.cwd(), fileArg);
    const summary = await importOwnershipXlsx(resolved);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const dir = path.resolve(process.cwd(), "data_src/1pct");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = getDb();
  const existingRows = db
    .prepare("SELECT DISTINCT period FROM holdings")
    .all() as { period: string }[];
  const existingPeriods = new Set(existingRows.map((r) => r.period));

  const listXlsx = () =>
    fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
      .sort()
      .map((f) => path.join(dir, f));

  let files = listXlsx();
  let importedAny = false;

  for (const f of files) {
    const preview = await parseOwnershipXlsx(f);
    if (!existingPeriods.has(preview.period)) {
      const summary = await importOwnershipXlsx(f, db);
      console.log(JSON.stringify(summary, null, 2));
      existingPeriods.add(summary.period);
      importedAny = true;
    }
  }

  if (!importedAny) {
    if (files.length === 0) {
      console.log("Folder data_src/1pct kosong, mencoba unduh dari IDX...");
      const downloaded = await fetchLatestFromIdx({ headless, outDir: dir });
      const summary = await importOwnershipXlsx(downloaded, db);
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(
        `Semua berkas di data_src/1pct (${files.length} berkas) sudah terimpor untuk periode: ${[
          ...existingPeriods,
        ].join(", ")}. Mengimpor ulang berkas terbaru untuk memastikan idempotensi...`
      );
      const latestFile = files[files.length - 1];
      const summary = await importOwnershipXlsx(latestFile, db);
      console.log(JSON.stringify(summary, null, 2));
    }
  }
}

main().catch((err) => {
  console.error("sync:ownership gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
