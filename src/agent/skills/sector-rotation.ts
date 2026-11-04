import { z } from "zod";
import { sectorRotation } from "@/db/queries";

export const schema = z.object({});

export const sectorRotationSkill = {
  name: "sector_rotation",
  description:
    "Hitung tabel rotasi sektor (return 5, 21, 63 hari bursa dan relatif terhadap IHSG beserta saham penggerak teratas tiap sektor).",
  schema,
  async run() {
    return sectorRotation();
  },
};
