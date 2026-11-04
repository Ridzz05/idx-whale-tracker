import { buildDocs } from "@/rag/build";
import { embedMissing } from "@/rag/embed";
import { runLoggedJob } from "@/market/audit";

async function main() {
  const summary = await runLoggedJob("index:rag", async () => {
    const buildSummary = buildDocs();
    const embedSummary = await embedMissing();
    return { ...buildSummary, ...embedSummary };
  });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("index:rag gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
