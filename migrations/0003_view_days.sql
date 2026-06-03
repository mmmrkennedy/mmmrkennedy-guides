-- Per-page, per-day view buckets, for "trending / popular this week".
-- Written alongside the running totals in functions/api/views.js (one extra
-- upsert per view POST). The /api/trending endpoint sums the last 7 days.
--
-- Apply in the D1 Console (dashboard) the same way as the earlier migrations:
-- paste this file's contents and Run. Until it exists, the daily bucket write
-- in views.js fails silently and the total counter keeps working.

CREATE TABLE IF NOT EXISTS view_days (
    path  TEXT NOT NULL,
    day   TEXT NOT NULL,            -- 'YYYY-MM-DD' (UTC)
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (path, day)
);

CREATE INDEX IF NOT EXISTS idx_view_days_day ON view_days(day);
