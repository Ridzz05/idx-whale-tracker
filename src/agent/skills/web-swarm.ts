import { z } from "zod";
import { runSwarm } from "@/web/swarm";

export const schema = z.object({
  question: z.string().min(2).describe("Pertanyaan atau topik yang perlu dicari di internet"),
  max_workers: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Jumlah sub-query paralel (default 3, maks 5)"),
  mode: z
    .enum(["auto", "native", "headless"])
    .optional()
    .describe("Mode pengambilan halaman: auto (native dulu, fallback headless), native, atau headless"),
});

export const webSwarmSkill = {
  name: "web_swarm",
  description:
    "Jalankan beberapa worker pencari internet secara paralel (native HTTP + fallback Playwright headless), rangkum halaman dengan URL sumber, dan simpan hasilnya ke knowledge base.",
  schema,
  async run(args: z.infer<typeof schema>, ctx?: unknown) {
    return runSwarm(
      {
        question: args.question,
        maxWorkers: args.max_workers ?? 3,
        mode: args.mode ?? "auto",
      },
      ctx
    );
  },
};
