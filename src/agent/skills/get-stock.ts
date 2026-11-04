import { z } from "zod";
import { getStock, stockHolders } from "@/db/queries";

export const schema = z.object({
  code: z.string().min(4).max(6).describe("Kode saham 4 huruf IDX, mis. AADI atau BBCA"),
});

export const getStockSkill = {
  name: "get_stock",
  description:
    "Ambil detail lengkap satu emiten saham (sektor, industri, harga terakhir, konsentrasi kepemilikan, dan daftar pemegang >1%).",
  schema,
  async run(args: z.infer<typeof schema>) {
    const stock = getStock(args.code);
    if (!stock) {
      return { error: `Saham ${args.code.toUpperCase()} tidak ditemukan di database` };
    }
    const holders = stockHolders(args.code, stock.period);
    return { stock, holders };
  },
};
