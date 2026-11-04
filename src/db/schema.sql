CREATE TABLE IF NOT EXISTS stocks (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT,
  industry TEXT,
  last_price REAL,
  profile_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS investors (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  local_foreign TEXT NOT NULL CHECK(local_foreign IN ('L','F'))
);

CREATE TABLE IF NOT EXISTS holdings (
  period TEXT NOT NULL,
  code TEXT NOT NULL REFERENCES stocks(code),
  investor_id INTEGER NOT NULL REFERENCES investors(id),
  shares_scripless INTEGER NOT NULL,
  shares_scrip INTEGER NOT NULL,
  total_shares INTEGER NOT NULL,
  pct REAL NOT NULL,
  PRIMARY KEY(period, code, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_holdings_investor_period ON holdings(investor_id, period);
CREATE INDEX IF NOT EXISTS idx_holdings_code_period ON holdings(code, period);

CREATE TABLE IF NOT EXISTS prices (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER,
  PRIMARY KEY(code, date)
);

CREATE TABLE IF NOT EXISTS bandar_scans (
  scan_date TEXT,
  code TEXT,
  score INTEGER,
  signal TEXT CHECK(signal IN ('accumulation','distribution')),
  net_flow_7d REAL,
  cmf20 REAL,
  vol_ratio REAL,
  explanation TEXT,
  PRIMARY KEY(scan_date, code)
);

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(kind, ref)
);

CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
  title,
  body,
  content='docs',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
  INSERT INTO docs_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
  INSERT INTO docs_fts(docs_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO docs_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TABLE IF NOT EXISTS doc_vectors (
  doc_id INTEGER PRIMARY KEY REFERENCES docs(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS market_alerts (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  price REAL,
  change_pct REAL
);

CREATE TABLE IF NOT EXISTS idx_quotes (
  code TEXT PRIMARY KEY,
  price REAL NOT NULL,
  prev_close REAL,
  change_pct REAL,
  open REAL,
  high REAL,
  low REAL,
  volume INTEGER,
  value REAL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idx_quote_history (
  code TEXT NOT NULL,
  ts TEXT NOT NULL,
  price REAL NOT NULL,
  volume INTEGER,
  value REAL,
  PRIMARY KEY(code, ts)
);

CREATE INDEX IF NOT EXISTS idx_quote_history_ts ON idx_quote_history(ts);

CREATE TABLE IF NOT EXISTS idx_index_quotes (
  index_code TEXT PRIMARY KEY,
  current REAL NOT NULL,
  change_pct REAL,
  idx_time TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  duration_ms INTEGER NOT NULL,
  rows INTEGER,
  message TEXT
);

CREATE INDEX IF NOT EXISTS api_log_ts ON api_log(ts);

CREATE TABLE IF NOT EXISTS capture_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  state TEXT NOT NULL,
  watchlist INTEGER,
  quotes INTEGER,
  lag_seconds INTEGER,
  duration_ms INTEGER,
  message TEXT
);

CREATE INDEX IF NOT EXISTS capture_log_ts ON capture_log(ts);
