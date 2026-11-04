import { buildDocs } from "@/rag/build";
import { embedMissing } from "@/rag/embed";

async function main() {
  const buildSummary = buildDocs();
  const embedSummary = await embedMissing();
  console.log(JSON.stringify({ ...buildSummary, ...embedSummary }, null, 2));
}

main().catch((err) => {
  console.error("index:rag gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
