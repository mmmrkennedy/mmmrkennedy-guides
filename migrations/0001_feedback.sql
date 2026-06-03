-- Guide feedback — inline line flags.
-- One row per submitted flag. The public "may be buggy" auto-note is derived
-- from this table (open + reason='buggy', counted by distinct ip_hash), so no
-- separate counts table is needed.

CREATE TABLE IF NOT EXISTS flags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT NOT NULL,
    line_hash  TEXT NOT NULL,                  -- stable content hash of the flagged line
    quote      TEXT NOT NULL,                  -- line text at flag time, for reviewer context
    reason     TEXT NOT NULL,                  -- 'unclear' | 'outdated' | 'wrong' | 'buggy'
    detail     TEXT NOT NULL,                  -- required, server-validated
    status     TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'resolved' | 'dismissed'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip_hash    TEXT                            -- hashed; for dedupe / rate-limit / abuse triage only
);

CREATE INDEX IF NOT EXISTS idx_flags_path   ON flags(path, status);
CREATE INDEX IF NOT EXISTS idx_flags_line   ON flags(line_hash, status);
CREATE INDEX IF NOT EXISTS idx_flags_status ON flags(status, created_at);

-- Enforce the (line_hash, ip_hash, reason) dedupe at the DB level so one person
-- can't inflate a count even if the application check is bypassed. NULL ip_hash
-- rows are not deduped (SQLite treats NULLs as distinct in a UNIQUE index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_flags_dedupe ON flags(line_hash, ip_hash, reason);
