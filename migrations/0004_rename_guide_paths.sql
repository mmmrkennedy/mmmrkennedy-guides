-- Repoint stored paths after four pages were renamed to the site-wide *_guide
-- convention (2026-07-24):
--
--   /games/BO6/the_tomb/the_tomb                            -> …/the_tomb_guide
--   /games/WW2/…/survival_maps/altar_of_blood               -> …/altar_of_blood_guide
--   /games/WW2/…/survival_maps/bodega_cervantes             -> …/bodega_cervantes_guide
--   /games/WW2/…/survival_maps/uss_mount_olympus            -> …/uss_mount_olympus_guide
--
-- Views and flags are keyed by URL path, so without this the renamed pages start
-- from zero and their existing flags are stranded under URLs that no longer exist.
--
-- Safe to run before OR after the deploy, and safe to run twice: `views` and
-- `view_days` are merged with ON CONFLICT (so counts already recorded against a
-- new path are added to, never overwritten), and the WHERE clauses stop matching
-- once the old rows are gone.
--
-- Apply in the D1 Console (dashboard): paste and Run, same as the earlier
-- migrations.

-- Preview what will move (optional — run on its own first):
--   SELECT 'views' AS tbl, path, count FROM views WHERE path IN (…)
--   UNION ALL SELECT 'view_days', path, SUM(count) FROM view_days WHERE path IN (…) GROUP BY path
--   UNION ALL SELECT 'flags', path, COUNT(*) FROM flags WHERE path IN (…) GROUP BY path;

-- 1. Running totals. Merge into the new path, then drop the old row.
INSERT INTO views (path, count)
SELECT path || '_guide', count
FROM views
WHERE path IN (
    '/games/BO6/the_tomb/the_tomb',
    '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
    '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
    '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus'
)
ON CONFLICT(path) DO UPDATE SET count = views.count + excluded.count;

DELETE FROM views
WHERE path IN (
    '/games/BO6/the_tomb/the_tomb',
    '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
    '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
    '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus'
);

-- 2. Daily buckets (feeds /api/trending). Same merge, per (path, day).
INSERT INTO view_days (path, day, count)
SELECT path || '_guide', day, count
FROM view_days
WHERE path IN (
    '/games/BO6/the_tomb/the_tomb',
    '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
    '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
    '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus'
)
ON CONFLICT(path, day) DO UPDATE SET count = view_days.count + excluded.count;

DELETE FROM view_days
WHERE path IN (
    '/games/BO6/the_tomb/the_tomb',
    '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
    '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
    '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus'
);

-- 3. Flags. `path` has no uniqueness constraint (dedupe is on line_hash, ip_hash,
-- reason), so a plain UPDATE is enough — no merge needed.
UPDATE flags
SET path = path || '_guide'
WHERE path IN (
    '/games/BO6/the_tomb/the_tomb',
    '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
    '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
    '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus'
);

-- ===========================================================================
-- VERIFICATION — read-only. Safe to run on their own, any number of times.
-- ===========================================================================

-- CHECK 1 (pass/fail): nothing may be left under the old paths.
-- Expect a single row reading 0 | 0 | 0. A non-zero column means that table's
-- statement above didn't apply — most often because the console ran only part
-- of the script, in which case re-run just that section.
SELECT
    (SELECT COUNT(*) FROM views WHERE path IN (
        '/games/BO6/the_tomb/the_tomb',
        '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
        '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
        '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus')) AS views_old_left,
    (SELECT COUNT(*) FROM view_days WHERE path IN (
        '/games/BO6/the_tomb/the_tomb',
        '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
        '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
        '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus')) AS view_days_old_left,
    (SELECT COUNT(*) FROM flags WHERE path IN (
        '/games/BO6/the_tomb/the_tomb',
        '/games/WW2/the_tortured_path/survival_maps/altar_of_blood',
        '/games/WW2/the_tortured_path/survival_maps/bodega_cervantes',
        '/games/WW2/the_tortured_path/survival_maps/uss_mount_olympus')) AS flags_old_left;

-- CHECK 2 (inventory): what now exists for these four pages across all three
-- tables. Every row should read 'new'. `n` is the view total, the summed daily
-- buckets, or the flag count, depending on which table the row came from.
--
-- An empty result is NOT a failure: these are four low-traffic pages (three
-- survival maps and one unwritten guide), so there may have been nothing to
-- carry over. CHECK 1 is the authoritative result.
SELECT
    CASE WHEN substr(path, -6) = '_guide' THEN 'new' ELSE 'OLD — not migrated' END AS state,
    tbl, path, n
FROM (
    SELECT 'views' AS tbl, path, count AS n FROM views
    UNION ALL SELECT 'view_days', path, SUM(count) FROM view_days GROUP BY path
    UNION ALL SELECT 'flags', path, COUNT(*) FROM flags GROUP BY path
)
WHERE path LIKE '%the_tomb%'
   OR path LIKE '%altar_of_blood%'
   OR path LIKE '%bodega_cervantes%'
   OR path LIKE '%uss_mount_olympus%'
ORDER BY state, tbl;

