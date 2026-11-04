import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveChromePath } from "@/lib/env";

const MANUAL_FALLBACK_MESSAGE =
  'Unduh manual dari idx.co.id (Keterbukaan Informasi, kata kunci "1%") ke data_src/1pct/ lalu jalankan ulang';

const IdxAnnouncementSchema = z.object({
  Replies: z
    .array(
      z.object({
        attachments: z
          .array(
            z.object({
              FullSavePath: z.string().optional(),
              OriginalFilename: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
});

export interface IdxFetchOptions {
  headless?: boolean;
  outDir?: string;
}

export async function fetchLatestFromIdx(opts?: IdxFetchOptions): Promise<string> {
  const outDir = opts?.outDir ?? path.resolve(process.cwd(), "data_src/1pct");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const executablePath = resolveChromePath();
  const headless = opts?.headless === true;

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(
      "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/",
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
    await page.waitForTimeout(4000);

    // Call the announcement API from inside the page so the Cloudflare cookies apply.
    const apiRaw: unknown = await page
      .evaluate(async () => {
        try {
          const now = new Date();
          const to = now.toISOString().slice(0, 10).replace(/-/g, "");
          const fromDate = new Date(now.getTime() - 120 * 86400 * 1000);
          const from = fromDate.toISOString().slice(0, 10).replace(/-/g, "");
          const url = `/primary/ListedCompany/GetAnnouncement?kodeEmiten=&indexFrom=0&pageSize=20&dateFrom=${from}&dateTo=${to}&lang=id&keyword=Pemegang%20saham%20diatas%201%25`;
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      })
      .catch(() => null);

    const parsedApi = IdxAnnouncementSchema.safeParse(apiRaw);
    if (parsedApi.success && parsedApi.data.Replies) {
      for (const item of parsedApi.data.Replies) {
        const attachments = item.attachments ?? [];
        const xlsxAtt = attachments.find((a) =>
          (a.OriginalFilename ?? a.FullSavePath ?? "").toLowerCase().endsWith(".xlsx")
        );
        if (xlsxAtt?.FullSavePath) {
          const fileUrl = xlsxAtt.FullSavePath.startsWith("http")
            ? xlsxAtt.FullSavePath
            : `https://www.idx.co.id${xlsxAtt.FullSavePath}`;
          const b64 = await page.evaluate(async (u: string) => {
            const r = await fetch(u, { credentials: "include" });
            if (!r.ok) return null;
            const buf = await r.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
          }, fileUrl);
          if (b64) {
            const fname =
              xlsxAtt.OriginalFilename ||
              path.basename(new URL(fileUrl).pathname) ||
              `ksei_1pct_${Date.now()}.xlsx`;
            const dest = path.join(outDir, fname);
            fs.writeFileSync(dest, Buffer.from(b64, "base64"));
            return dest;
          }
        }
      }
    }

    // Fall back to the search UI and click the first xlsx link.
    const searchInput = page
      .locator('input[type="search"], input[placeholder*="Cari"], input[placeholder*="kata kunci"]')
      .first();
    if ((await searchInput.count()) > 0) {
      await searchInput.fill("Pemegang saham diatas 1%");
      await searchInput.press("Enter");
      await page.waitForTimeout(3000);
    }

    const xlsxLink = page.locator('a[href$=".xlsx"], a[href*=".xlsx"]').first();
    if ((await xlsxLink.count()) > 0) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 20000 }),
        xlsxLink.click(),
      ]);
      const suggested = download.suggestedFilename() || `ksei_1pct_${Date.now()}.xlsx`;
      const dest = path.join(outDir, suggested);
      await download.saveAs(dest);
      return dest;
    }
  } catch {
    // Fall through to explicit contingency error below
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  throw new Error(MANUAL_FALLBACK_MESSAGE);
}
