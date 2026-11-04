import { z } from "zod";
import { fetchPage } from "@/web/fetch";

export const schema = z.object({
  url: z.string().url().describe("URL publik (http/https) yang ingin dibaca"),
  mode: z
    .enum(["auto", "native", "headless"])
    .optional()
    .describe("Mode pengambilan: auto, native, atau headless"),
});

export const fetchUrlSkill = {
  name: "fetch_url",
  description:
    "Baca isi teks bersih dari satu URL publik (native fetch dulu, otomatis fallback ke Playwright headless bila diblokir atau halaman berbasis JS).",
  schema,
  async run(args: z.infer<typeof schema>) {
    return fetchPage(args.url, args.mode ?? "auto");
  },
};
