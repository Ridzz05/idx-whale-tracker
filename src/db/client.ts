import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";

let dbInstance: DatabaseSync | null = null;
let currentDbPath: string | null = null;
let isTestOverride = false;

const SCHEMA_SQL = fs.readFileSync(
  path.resolve(/* turbopackIgnore: true */ process.cwd(), "src/db/schema.sql"),
  "utf8"
);

export function initDb(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(SCHEMA_SQL);
}

export function getDb(customPath?: string): DatabaseSync {
  if (!customPath && isTestOverride && dbInstance) {
    return dbInstance;
  }
  const target =
    customPath ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), getEnv().DB_PATH);
  if (dbInstance && currentDbPath === target) {
    return dbInstance;
  }
  if (target !== ":memory:") {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(target);
  initDb(db);
  if (!customPath) {
    dbInstance = db;
    currentDbPath = target;
  }
  return db;
}

export function resetDbForTests(db: DatabaseSync, tag = ":memory:") {
  dbInstance = db;
  currentDbPath = tag;
  isTestOverride = true;
}
