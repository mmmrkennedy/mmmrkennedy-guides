-- Solver flags — state snapshots.
--
-- A line flag is self-describing: the quote IS the thing being reported. A solver
-- flag is not — the bug lives in the inputs, and no amount of prose recovers them
-- ("The solver was wrong" was a real report, and unactionable). These three
-- columns carry the solver's state at flag time so a report can be reproduced.
--
-- All nullable with no default: existing rows stay valid line flags, nothing to
-- backfill, and `solver IS NULL` is the test for "this is a plain line flag".
--
-- Note there is no new dedupe index. Solver flags set line_hash to a hash of
-- (solver name + canonical input state), so the existing
-- UNIQUE (line_hash, ip_hash, reason) stops one person re-reporting the SAME
-- broken state while still letting them report a different one — and
-- COUNT(DISTINCT ip_hash) per line_hash becomes "N people hit this exact input".

ALTER TABLE flags ADD COLUMN solver   TEXT;  -- component name, e.g. 'BeastVenomXBoxSolver'
ALTER TABLE flags ADD COLUMN snapshot TEXT;  -- JSON: { v, solver, state, output, error, build, vp }
ALTER TABLE flags ADD COLUMN expected TEXT;  -- what the reporter says the answer should have been

CREATE INDEX IF NOT EXISTS idx_flags_solver ON flags(solver, status);
