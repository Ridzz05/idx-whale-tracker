import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { chromium, type Browser } from "playwright-core";
import { resolveChromePath } from "@/lib/env";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARS = 6000;

export type FetchMode = "auto" | "native" | "headless";

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  via: "native" | "headless";
}

export function assertSafePublicUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`URL tidak valid: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Protokol ditolak (hanya http/https): ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    throw new Error(`Host loopback/privat ditolak (SSRF): ${host}`);
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    ) {
      throw new Error(`IP privat/loopback ditolak (SSRF): ${host}`);
    }
  }
  return u;
}

export function extractReadableText(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  try {
    const reader = new Readability(document as unknown as Document);
    const parsed = reader.parse();
    if (parsed && parsed.textContent) {
      const cleaned = parsed.textContent.replace(/\s+/g, " ").trim();
      const title = (parsed.title || document.title || url).replace(/\s+/g, " ").trim();
      return {
        title,
        text: cleaned.slice(0, MAX_CHARS),
      };
    }
  } catch {
    // Fallback to body text extraction
  }
  const fallbackText = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const title = (document.title || url).replace(/\s+/g, " ").trim();
  return {
    title,
    text: fallbackText.slice(0, MAX_CHARS),
  };
}

async function fetchNative(u: URL): Promise<{ status: number; title: string; text: string }> {
  const res = await fetch(u.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (res.url) {
    assertSafePublicUrl(res.url);
  }

  const status = res.status;
  if (status === 403 || status === 429 || status === 503) {
    return { status, title: "", text: "" };
  }
  if (!res.ok) {
    throw new Error(`HTTP ${status}`);
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct && !ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
    throw new Error(`Content-Type tidak didukung: ${ct}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const raw = await res.text();
    const { title, text } = extractReadableText(raw.slice(0, MAX_BYTES), u.toString());
    return { status, title, text };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BYTES) {
        chunks.push(value.subarray(0, value.byteLength - (total - MAX_BYTES)));
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  }
  const html = Buffer.concat(chunks).toString("utf8");
  if (ct.includes("text/plain")) {
    return {
      status,
      title: u.hostname,
      text: html.replace(/\s+/g, " ").trim().slice(0, MAX_CHARS),
    };
  }
  const { title, text } = extractReadableText(html, u.toString());
  return { status, title, text };
}

async function fetchHeadless(
  u: URL,
  sharedBrowser?: Browser
): Promise<{ title: string; text: string }> {
  const ownBrowser = !sharedBrowser;
  const browser =
    sharedBrowser ??
    (await chromium.launch({
      executablePath: resolveChromePath(),
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"],
    }));

  const context = await browser.newContext({
    userAgent: USER_AGENT,
  });
  try {
    const page = await context.newPage();
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    const finalUrl = page.url();
    if (finalUrl) {
      assertSafePublicUrl(finalUrl);
    }
    const html = await page.content();
    return extractReadableText(html, u.toString());
  } finally {
    await context.close().catch(() => {});
    if (ownBrowser) {
      await browser.close().catch(() => {});
    }
  }
}

export async function fetchPage(
  url: string,
  mode: FetchMode = "auto",
  sharedBrowser?: Browser
): Promise<FetchedPage> {
  const u = assertSafePublicUrl(url);

  if (mode === "headless") {
    const { title, text } = await fetchHeadless(u, sharedBrowser);
    return { url: u.toString(), title, text, via: "headless" };
  }

  if (mode === "native") {
    const { status, title, text } = await fetchNative(u);
    if (status === 403 || status === 429 || status === 503) {
      throw new Error(`HTTP ${status}`);
    }
    return { url: u.toString(), title, text, via: "native" };
  }

  // mode === 'auto': native first, fallback to headless on 403/429/503, network error, or text < 500 chars
  try {
    const { status, title, text } = await fetchNative(u);
    if (status !== 403 && status !== 429 && status !== 503 && text.length >= 500) {
      return { url: u.toString(), title, text, via: "native" };
    }
  } catch {
    // Fallback to headless below
  }

  const { title, text } = await fetchHeadless(u, sharedBrowser);
  return { url: u.toString(), title, text, via: "headless" };
}
