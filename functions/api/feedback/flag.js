// POST /api/feedback/flag
// Records a single line flag. Body: { path, line_hash, quote, reason, detail },
// plus { solver, snapshot, expected } when the flag comes from a solver rather
// than a line of prose (see the SOLVER FLAGS note in ts/ui/line-flagger.ts).
//
// All client validation is re-enforced here — never trust the client. Dedupe is
// enforced both in SQL (INSERT OR IGNORE against the UNIQUE (line_hash, ip_hash,
// reason) index) so one person can't inflate a buggy count.

import { normalizePath, json, hashIp, notifyFlag } from "../_shared.js";

const REASONS = new Set(["unclear", "outdated", "wrong", "buggy"]);
const MAX_QUOTE = 300;
const MAX_DETAIL = 1000;
const MAX_LINE_HASH = 64;
const MIN_DETAIL = 4;
const MAX_SOLVER = 64;
const MAX_EXPECTED = 200;
/** Cap on the raw snapshot JSON. The client aims for 7800, so this has headroom. */
const MAX_SNAPSHOT = 8192;
/* Structural caps applied while re-building the snapshot below. A snapshot is
 * client-authored JSON: it is parsed, walked, and re-serialized from scratch, so
 * what lands in D1 is a value this file constructed, never a string a browser
 * handed us.
 *
 * The depth allowance has to clear a real solver's inputs, not just a flat form:
 * a board arrives as {state:{"Control rods":[[0,1],[2,3]]}}, which is already
 * five levels down before anything unusual happens. Too tight a cap doesn't
 * reject those — walk() nulls the offending branch — so the report would arrive
 * looking empty rather than looking rejected. */
const SNAP_MAX_DEPTH = 8;
const SNAP_MAX_KEYS = 80;
const SNAP_MAX_ITEMS = 200;
const SNAP_MAX_STRING = 300;

/**
 * Rebuild `raw` as a plain JSON value within the structural caps, or return null
 * if it isn't usable. Rejecting outright (rather than repairing quietly) keeps a
 * malformed snapshot from being stored as half a report.
 */
function sanitizeSnapshot(raw) {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_SNAPSHOT) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const walk = (value, depth) => {
        if (value === null) return null;
        const t = typeof value;
        if (t === "string") return value.slice(0, SNAP_MAX_STRING);
        if (t === "boolean") return value;
        if (t === "number") return Number.isFinite(value) ? value : null;
        if (depth >= SNAP_MAX_DEPTH) return null;
        if (Array.isArray(value)) {
            return value.slice(0, SNAP_MAX_ITEMS).map((v) => walk(v, depth + 1));
        }
        if (t === "object") {
            const out = {};
            let n = 0;
            for (const [k, v] of Object.entries(value)) {
                if (n >= SNAP_MAX_KEYS) break;
                out[String(k).slice(0, SNAP_MAX_STRING)] = walk(v, depth + 1);
                n++;
            }
            return out;
        }
        return null; // functions, symbols, undefined — not reachable from JSON
    };

    const clean = JSON.stringify(walk(parsed, 0));
    return clean.length > MAX_SNAPSHOT ? null : clean;
}

export async function onRequestPost({ request, env, waitUntil }) {
    if (!env.DB) return json({ error: "D1 binding 'DB' is not configured" }, 500);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: "invalid JSON body" }, 400);
    }

    const path = normalizePath(body && body.path);
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);

    const reason = body.reason;
    if (!REASONS.has(reason)) return json({ error: "invalid 'reason'" }, 400);

    const lineHash = typeof body.line_hash === "string" ? body.line_hash.trim() : "";
    if (!lineHash || lineHash.length > MAX_LINE_HASH || !/^[a-f0-9]+$/i.test(lineHash)) {
        return json({ error: "invalid 'line_hash'" }, 400);
    }

    const detail = typeof body.detail === "string" ? body.detail.trim() : "";
    // Required for every reason; reject low-effort input (too short, or a single
    // repeated character like "aaaa" / "....").
    if (detail.length < MIN_DETAIL || detail.length > MAX_DETAIL || /^(.)\1*$/.test(detail)) {
        return json({ error: "invalid 'detail'" }, 400);
    }

    const quote = (typeof body.quote === "string" ? body.quote : "").trim().slice(0, MAX_QUOTE);

    // Solver fields. All three are optional and all three hang off `solver`: a
    // snapshot with no solver to attribute it to is a malformed request, not a
    // line flag with extra baggage, so it's rejected rather than dropped.
    let solver = null;
    let snapshot = null;
    let expected = null;
    if (body.solver !== undefined && body.solver !== null) {
        if (typeof body.solver !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.solver)) {
            return json({ error: "invalid 'solver'" }, 400);
        }
        solver = body.solver.slice(0, MAX_SOLVER);

        if (body.snapshot !== undefined && body.snapshot !== null) {
            snapshot = sanitizeSnapshot(body.snapshot);
            if (snapshot === null) return json({ error: "invalid 'snapshot'" }, 400);
        }
        if (typeof body.expected === "string" && body.expected.trim()) {
            expected = body.expected.trim().slice(0, MAX_EXPECTED);
        }
    } else if (body.snapshot !== undefined || body.expected !== undefined) {
        return json({ error: "'snapshot' requires 'solver'" }, 400);
    }

    const ipHash = await hashIp(request, env);

    let result;
    try {
        result = await env.DB.prepare(
            "INSERT OR IGNORE INTO flags (path, line_hash, quote, reason, detail, ip_hash, solver, snapshot, expected) " +
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
            .bind(path, lineHash, quote, reason, detail, ipHash, solver, snapshot, expected)
            .run();
    } catch {
        return json({ error: "could not record flag" }, 500);
    }

    // Notify only on a genuinely new row — INSERT OR IGNORE drops duplicates, so
    // a re-flag of the same line writes nothing and shouldn't send a message.
    if (result && result.meta && result.meta.changes > 0) {
        const notify = notifyFlag(env, request, { path, reason, quote, detail, solver, expected });
        if (waitUntil) waitUntil(notify);
        else await notify;
    }

    return json({ ok: true });
}
