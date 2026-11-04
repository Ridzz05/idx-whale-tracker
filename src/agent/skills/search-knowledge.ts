import { z } from "zod";
import { retrieve } from "@/rag/retrieve";

export const schema = z.object({
  query: z.string().min(1).describe("Kata kunci atau pertanyaan pencarian di knowledge base"),
  k: z.number().int().min(1).max(20).optional().describe("Jumlah dokumen hasil (default 8)"),
});

export const searchKnowledgeSkill = {
  name: "search_knowledge",
  description:
    "Cari dokumen di database pengetahuan (profil saham, portofolio investor, sinyal bandar detector, rotasi sektor, dan temuan web sebelumnya).",
  schema,
  async run(args: z.infer<typeof schema>) {
    const docs = await retrieve(args.query, args.k ?? 8);
    return { count: docs.length, docs };
  },
};
