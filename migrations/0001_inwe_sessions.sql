-- D1 schema migration for iNwe Quo Pro v1
-- Run this against your Cloudflare D1 database:
--   wrangler d1 execute inwe-quo-pro --file=migrations/0001_inwe_sessions.sql

CREATE TABLE IF NOT EXISTS InweSession (
  id           TEXT PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  cookie       TEXT NOT NULL,
  authToken    TEXT,
  level        INTEGER,
  pointPct     REAL,
  hoursLeft    INTEGER,
  referred     INTEGER,
  status       TEXT DEFAULT 'active',
  lastChecked  TEXT NOT NULL,
  createdAt    TEXT NOT NULL
);
