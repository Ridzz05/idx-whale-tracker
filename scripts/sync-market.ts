import { closeRelay } from "@/capture/relay";
import { syncMarket } from "@/ingest/market";
import { runLoggedJob } from "@/market/audit";

async function main() {
  const args = process.argv.slice(2);
  let sessions: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sessions" && args[i + 1]) {
      sessions = Number(args[i + 1]);
      i++;
    } else if (args[i].startsWith("--sessions=")) {
      sessions = Number(args[i].slice("--sessions=".length));
    }
  }

  // The relay socket keeps the Node event loop alive after the work is done.
  try {
    const summary = await runLoggedJob("sync:market", () => syncMarket({ sessions }));
    console.log(
      JSON.stringify(
        {
          sessions: summary.sessions,
          datesFetched: summary.datesFetched,
          priceRows: summary.priceRows,
          ihsgRows: summary.ihsgRows,
          stocksUpserted: summary.stocksUpserted,
          failedCount: summary.failed.length,
          failedSample: summary.failed.slice(0, 10),
        },
        null,
        2
      )
    );
  } finally {
    closeRelay();
  }
}

main().catch((err) => {
  closeRelay();
  console.error("sync:market gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
