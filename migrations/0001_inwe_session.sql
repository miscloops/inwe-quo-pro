CREATE TABLE IF NOT EXISTS InweSession (
id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, cookie TEXT NOT NULL, authToken TEXT,
level INTEGER, pointPct REAL, hoursLeft INTEGER, referred INTEGER,
status TEXT NOT NULL DEFAULT 'active', lastChecked TEXT NOT NULL, createdAt TEXT NOT NULL
);
