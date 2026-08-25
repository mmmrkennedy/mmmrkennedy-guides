-- Reading analytics — one row per pageview.
--
-- The `views` / `view_days` tables answer "which guide is popular". They cannot
-- answer the question that changes what gets written next: which SECTIONS of a
-- guide people actually read, and where they stop. A guide is 15-30
-- `.content-container[id]` blocks, and those ids are already stable and unique,
-- so they make free analytics keys.
--
-- ROW PER PAGEVIEW, NOT COUNTERS
--
-- Measured traffic is ~650-1,000 pageviews/day (from /api/trending), so a row
-- per pageview costs ~1k writes/day against D1's 100k/day free-tier cap, and
-- ~150MB/year against 5GB. Per-section counter upserts would be ~15x the writes
-- and would still have to be re-shaped for every new question. Aggregation
-- happens at read time instead, with json_each over `sections`.
--
-- PVID, AND WHY THE WRITE IS AN UPSERT
--
-- Readers of this site alt-tab constantly: the whole point of a guide is to do
-- the step in the game. Sending a beacon on each visibilitychange would mint 20
-- rows for one read. So every beacon carries the same client-generated random
-- `pvid` and the full cumulative state, and the write is an upsert — the row is
-- overwritten in place and rows stay 1:1 with pageviews. `hides` counts how many
-- times the tab went away, which on this site reads as "steps executed in game".
--
-- `pvid` identifies a ROW, not a person: 16 random hex per page load, held in a
-- JS variable and never stored client-side. Nothing here is derived from an IP
-- or a user agent; see functions/api/reading.js.
--
-- Apply in the D1 Console (dashboard) the same way as the earlier migrations:
-- paste this file's contents and Run.

CREATE TABLE IF NOT EXISTS pageviews (
    pvid      TEXT PRIMARY KEY,           -- random per pageview; row key only
    day       TEXT NOT NULL,              -- 'YYYY-MM-DD' (UTC), server clock
    ts        INTEGER NOT NULL,           -- epoch seconds of the FIRST beacon
    updated   INTEGER NOT NULL,           -- epoch seconds of the LAST beacon
    path      TEXT NOT NULL,              -- normalizePath()'d, matches `views`.path
    prev      INTEGER NOT NULL DEFAULT 0, -- 1 = *.pages.dev preview deploy, not real traffic
    sess      TEXT,                       -- per-tab random id, dies with the tab
    ref       TEXT,                       -- referrer bucket ('google', 'direct', ...)
    dev       TEXT,                       -- 'mobile' | 'tablet' | 'desktop'
    cc        TEXT,                       -- CF-IPCountry, 2 letters
    engaged   INTEGER NOT NULL DEFAULT 0, -- seconds visible AND focused
    depth     INTEGER NOT NULL DEFAULT 0, -- max scroll depth, 0-100
    hides     INTEGER NOT NULL DEFAULT 0, -- times the tab was backgrounded
    sec_first TEXT,                       -- first section reached (entry point)
    sec_last  TEXT,                       -- section on screen at the last tick (exit point)
    sections  TEXT,                       -- JSON { "<section-id>": <dwell seconds> }
    events    TEXT,                       -- JSON [ ["toc","main_ee"], ["img","pap.webp"] ]
    solvers   TEXT                        -- JSON { "<SolverName>": {m,e,n,f,t} }
);

-- The three shapes the dashboard queries in: one guide over a window, the whole
-- site over a window, and one tab's journey across pages.
CREATE INDEX IF NOT EXISTS idx_pv_path_day ON pageviews(path, day);
CREATE INDEX IF NOT EXISTS idx_pv_day      ON pageviews(day);
CREATE INDEX IF NOT EXISTS idx_pv_sess     ON pageviews(sess, ts);
