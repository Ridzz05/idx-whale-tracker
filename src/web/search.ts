import { parseHTML } from "linkedom";
import { chromium } from "playwright-core";
import { resolveChromePath } from "@/lib/env";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export function decodeBingUrl(rawHref: string): string {
  try {
    const parsed = new URL(rawHref, "https://www.bing.com");
    if (
      (parsed.hostname.endsWith("bing.com") || parsed.hostname === "www.bing.com") &&
      parsed.pathname.startsWith("/ck/a")
    ) {
      const u = parsed.searchParams.get("u");
      if (u && u.startsWith("a1")) {
        const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
        const decoded = Buffer.from(b64, "base64").toString("utf8");
        if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
          return decoded;
        }
      }
    }
    return parsed.toString();
  } catch {
    return rawHref;
  }
}

export function parseBingHtml(html: string, n: number): SearchHit[] {
  const { document } = parseHTML(html);
  const items = document.querySelectorAll("li.b_algo");
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  for (const li of items) {
    const a = li.querySelector("h2 a");
    if (!a) continue;
    const rawHref = a.getAttribute("href") ?? "";
    if (!rawHref) continue;
    const url = decodeBingUrl(rawHref);
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host === "bing.com" || host.endsWith(".bing.com")) continue;
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);

    const title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const cap = li.querySelector(".b_caption p, .b_lineclamp2, .b_lineclamp3, .b_caption");
    const snippet = (cap?.textContent ?? "").replace(/\s+/g, " ").trim();
    hits.push({ title, url, snippet });
    if (hits.length >= n) break;
  }

  return hits;
}

export async function nativeSearch(q: string, n = 5): Promise<SearchHit[]> {
  const targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=id`;

  let hits: SearchHit[] = [];
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = await res.text();
      hits = parseBingHtml(html, n);
    }
  } catch {
    // Fall through to Playwright contingency
  }

  // Bing can serve a JS gate or CAPTCHA to plain HTTP; retry through headless Chrome.
  if (hits.length === 0) {
    let browser;
    try {
      browser = await chromium.launch({
        executablePath: resolveChromePath(),
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
      });
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        locale: "id-ID",
      });
      const page = await context.newPage();
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(1500);
      const html = await page.content();
      hits = parseBingHtml(html, n);
    } catch {
      // Ignore and let search_empty fire below
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  if (hits.length === 0) {
    throw new Error("search_empty");
  }
  return hits;
}
