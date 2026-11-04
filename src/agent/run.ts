import type OpenAI from "openai";
import { getEnv } from "@/lib/env";
import { createLlmClient } from "./llm";
import { executeSkill, getOpenAiTools } from "./skills";

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; name: string; args: unknown }
  | { type: "tool_end"; name: string; ms: number }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ChatInputMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `Anda adalah asisten riset pasar saham Indonesia (IDX / KSEI >1% ownership) untuk aplikasi Whale Tracker.
Aturan wajib:
1. Jawab dalam bahasa Indonesia dengan ringkas, faktual, dan sebutkan periode data kepemilikan saat menyajikan angka dari sistem.
2. Selalu gunakan tool data sistem (get_stock, top_holders, get_investor, search_knowledge, sector_rotation, bandar_signals) terlebih dahulu sebelum menjawab pertanyaan tentang saham, investor, sektor, atau sinyal bandar.
3. Gunakan web_swarm atau fetch_url HANYA untuk informasi di luar database (misalnya berita terbaru, makroekonomi, harga komoditas, aksi korporasi terkini) dan sertakan URL sumber secara eksplisit.
4. Jangan pernah menebak atau mengarang angka kepemilikan atau harga.
5. Sertakan penafian singkat bila relevan: informasi ini untuk riset dan bukan rekomendasi investasi.`;

export async function runAgent(
  inputMessages: ChatInputMessage[],
  emit: (ev: AgentEvent) => void
): Promise<void> {
  const env = getEnv();
  const client = createLlmClient();
  const tools = getOpenAiTools();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...inputMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const maxIterations = 8;
  for (let iter = 0; iter < maxIterations; iter++) {
    const stream = await client.chat.completions.create({
      model: env.LLM_MODEL,
      messages,
      tools,
      stream: true,
    });

    let assistantContent = "";
    const toolCallsByIndex = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        assistantContent += delta.content;
        emit({ type: "token", text: delta.content });
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let entry = toolCallsByIndex.get(idx);
          if (!entry) {
            entry = {
              id: tc.id ?? `call_${iter}_${idx}`,
              name: tc.function?.name ?? "",
              arguments: "",
            };
            toolCallsByIndex.set(idx, entry);
          } else {
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            entry.arguments += tc.function.arguments;
          }
        }
      }
    }

    const toolCalls = [...toolCallsByIndex.values()].filter((t) => t.name);
    if (toolCalls.length === 0) {
      emit({ type: "done" });
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantContent || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    });

    const toolResults = await Promise.all(
      toolCalls.map(async (tc) => {
        let parsedArgs: unknown = {};
        try {
          parsedArgs = tc.arguments.trim() ? JSON.parse(tc.arguments) : {};
        } catch {
          parsedArgs = { raw: tc.arguments };
        }
        emit({ type: "tool_start", name: tc.name, args: parsedArgs });
        const t0 = Date.now();
        const resultStr = await executeSkill(tc.name, tc.arguments);
        const ms = Date.now() - t0;
        emit({ type: "tool_end", name: tc.name, ms });
        return {
          role: "tool" as const,
          tool_call_id: tc.id,
          content: resultStr,
        };
      })
    );

    messages.push(...toolResults);
  }

  emit({ type: "token", text: "\n\nBatas langkah agent tercapai." });
  emit({ type: "done" });
}
