import { z } from "zod";
import { latestBandarScan } from "@/db/queries";

export const schema = z.object({
  signal: z
    .enum(["accumulation", "distribution"])
    .optional()
    .describe("Filter sinyal accumulation atau distribution"),
  limit: z.number().int().min(1).max(100).optional().describe("Batas jumlah baris (default 25)"),
});

export const bandarSignalsSkill = {
  name: "bandar_signals",
  description:
    "Ambil hasil scan terbaru Bandar Detector (sinyal accumulation / distribution, skor 0-100, net flow 7 hari, CMF20, rasio volume).",
  schema,
  async run(args: z.infer<typeof schema>) {
    return latestBandarScan({
      signal: args.signal,
      limit: args.limit ?? 25,
    });
  },
};
