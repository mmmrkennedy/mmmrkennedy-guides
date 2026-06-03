// POST /api/feedback/flag
// Records a single line flag. Body: { path, line_hash, quote, reason, detail }.
//
// All client validation is re-enforced here — never trust the client. Dedupe is
// enforced both in SQL (INSERT OR IGNORE against the UNIQUE (line_hash, ip_hash,
// reason) index) so one person can't inflate a buggy count.

import { normalizePath, json, hashIp } from "../_shared.js";

const REASONS = new Set(["unclear", "outdated", "wrong", "buggy"]);
const MAX_QUOTE = 300;
const MAX_DETAIL = 1000;
const MAX_LINE_HASH = 64;
const MIN_DETAIL = 4;

export async function onRequestPost({ request, env }) {
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

    const ipHash = await hashIp(request, env);

    try {
        await env.DB.prepare(
            "INSERT OR IGNORE INTO flags (path, line_hash, quote, reason, detail, ip_hash) " +
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
            .bind(path, lineHash, quote, reason, detail, ipHash)
            .run();
    } catch {
        return json({ error: "could not record flag" }, 500);
    }

    return json({ ok: true });
}
