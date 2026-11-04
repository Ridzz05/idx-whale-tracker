import { z } from "zod";
import {
  findInvestorsByNameOrId,
  investorHoldings,
  investorSectorAllocation,
  latestPeriod,
} from "@/db/queries";

export const schema = z.object({
  name_or_id: z
    .string()
    .min(1)
    .describe("Nama investor (atau bagian nama) atau ID numerik investor"),
});

export const getInvestorSkill = {
  name: "get_investor",
  description:
    "Cari investor berdasarkan nama atau ID; mengembalikan profil, daftar kepemilikan saham >1%, nilai portofolio, dan alokasi sektor.",
  schema,
  async run(args: z.infer<typeof schema>) {
    const candidates = findInvestorsByNameOrId(args.name_or_id);
    if (candidates.length === 0) {
      return { error: `Investor '${args.name_or_id}' tidak ditemukan` };
    }
    const period = latestPeriod();
    const primary = candidates[0];
    const holdings = investorHoldings(primary.id, period);
    const sectors = investorSectorAllocation(primary.id, period);
    return {
      period,
      investor: primary,
      holdings,
      sector_allocation: sectors,
      other_candidates: candidates.slice(1),
    };
  },
};
