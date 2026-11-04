import { ensureFeed } from "@/market/feed";
import type { FeedEvent } from "@/market/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 25_000;

export async function GET(req: Request) {
  const feed = ensureFeed();
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: FeedEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      send({ type: "hello", status: feed.status(), alerts: feed.recentAlerts(30) });

      const unsubscribe = feed.subscribe(send);
      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, KEEPALIVE_MS);

      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // The stream was already closed by the client.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
