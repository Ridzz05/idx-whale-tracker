import { NextResponse } from "next/server";
import { z } from "zod";
import { isLlmConfigured } from "@/agent/llm";
import { runAgent, type AgentEvent } from "@/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    )
    .min(1)
    .max(40),
});

export async function POST(req: Request) {
  if (!isLlmConfigured()) {
    return NextResponse.json(
      { error: "LLM belum dikonfigurasi" },
      { status: 503 }
    );
  }

  let parsedBody: z.infer<typeof RequestSchema>;
  try {
    const json: unknown = await req.json();
    parsedBody = RequestSchema.parse(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Body request tidak valid" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };
      try {
        await runAgent(parsedBody.messages, send);
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
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
