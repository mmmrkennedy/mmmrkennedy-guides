-- Per-page view counter, migrated off Workers KV onto D1.
-- One row per path. The POST handler increments with an atomic upsert
-- (INSERT ... ON CONFLICT DO UPDATE ... RETURNING count), which removes the
-- read-modify-write race the KV version had.
--
-- Existing KV counts are backfilled once via build_scripts/migrate-kv-to-d1.js
-- (see docs/feedback-runbook.md). A few views during the cutover window are
-- expected to be lost — acceptable for a vanity counter.

CREATE TABLE IF NOT EXISTS views (
    path  TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
);
