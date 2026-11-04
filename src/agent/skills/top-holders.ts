import { z } from "zod";
import { latestPeriod, stockHolders } from "@/db/queries";

export const schema = z.object({
  code: z.string().min(4).max(6).describe("Kode saham 4 huruf IDX, mis. AADI atau BBCA"),
});

export const topHoldersSkill = {
  name: "top_holders",
  description:
    "Ambil daftar pemegang saham di atas 1% untuk suatu kode emiten beserta persentase, jumlah lembar, dan nilai kepemilikan.",
  schema,
  async run(args: z.infer<typeof schema>) {
    const period = latestPeriod();
    const holders = stockHolders(args.code, period);
    if (holders.length === 0) {
      return { error: `Tidak ada data pemegang >1% untuk ${args.code.toUpperCase()}` };
    }
    return {
      code: args.code.toUpperCase(),
      period,
      holders,
    };
  },
};
