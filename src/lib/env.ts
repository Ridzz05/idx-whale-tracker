import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, ".env"));
}

const envSchema = z.object({
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default(""),
  EMBEDDING_MODEL: z.string().default(""),
  DB_PATH: z.string().default("data/whale.db"),
  CHROME_PATH: z.string().default(""),
  RELAY_URL: z.string().default("http://127.0.0.1:9224"),
  IDX_WATCHLIST_SIZE: z.coerce.number().int().min(10).max(300).default(30),
  IDX_REQUEST_GAP_MS: z.coerce.number().int().min(500).max(10000).default(1500),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  ensureLoaded();
  return envSchema.parse({
    LLM_BASE_URL: process.env.LLM_BASE_URL || undefined,
    LLM_API_KEY: process.env.LLM_API_KEY || undefined,
    LLM_MODEL: process.env.LLM_MODEL || undefined,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || undefined,
    IDX_WATCHLIST_SIZE: process.env.IDX_WATCHLIST_SIZE || undefined,
    IDX_REQUEST_GAP_MS: process.env.IDX_REQUEST_GAP_MS || undefined,
    CHROME_PATH: process.env.CHROME_PATH || undefined,
    RELAY_URL: process.env.RELAY_URL || undefined,
  });
}

export function resolveChromePath(): string | undefined {
  const { CHROME_PATH } = getEnv();
  if (CHROME_PATH && fs.existsSync(CHROME_PATH)) return CHROME_PATH;
  const progFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const winDefault = path.join(progFiles, "Google", "Chrome", "Application", "chrome.exe");
  if (fs.existsSync(winDefault)) return winDefault;
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const pwDir = path.join(localAppData, "ms-playwright");
    if (fs.existsSync(pwDir)) {
      const entries = fs.readdirSync(pwDir).filter((e) => e.startsWith("chromium-")).sort().reverse();
      for (const e of entries) {
        const candidate = path.join(pwDir, e, "chrome-win", "chrome.exe");
        if (fs.existsSync(candidate)) return candidate;
        const candidate64 = path.join(pwDir, e, "chrome-win64", "chrome.exe");
        if (fs.existsSync(candidate64)) return candidate64;
      }
    }
  }
  return undefined;
}
