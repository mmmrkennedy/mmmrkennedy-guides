// GET /api/feedback?path=...
// Returns the lines on a page whose OPEN "buggy" reports (counted by distinct
// ip_hash) have crossed the threshold, so the client can render a caution note.
//
// Response: { path, buggy: [ { line_hash, reports } ] }
//
// Cached at the edge (~5 min) via the Cache API: the set changes slowly, and
// caching keeps D1 reads near zero — same lesson as the view counter.

import { normalizePath, json } from "../_shared.js";

const THRESHOLD = 5; // distinct ip_hash count of open buggy reports to surface a line
const CACHE_TTL = 300; // seconds

export async function onRequestGet({ request, env, waitUntil }) {
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);

    // Public read that must never break the page: with no DB, degrade to "no
    // buggy lines" rather than erroring.
    if (!env.DB) return json({ path, buggy: [] }, 200);

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    let buggy = [];
    try {
        const { results } = await env.DB.prepare(
            "SELECT line_hash, COUNT(DISTINCT ip_hash) AS reports " +
                "FROM flags " +
                "WHERE path = ?1 AND status = 'open' AND reason = 'buggy' " +
                "GROUP BY line_hash " +
                "HAVING reports >= ?2",
        )
            .bind(path, THRESHOLD)
            .all();
        buggy = (results || []).map((r) => ({ line_hash: r.line_hash, reports: r.reports }));
    } catch {
        // Don't break the page on a query error — return empty, uncached.
        return json({ path, buggy: [] }, 200);
    }

    const resp = json({ path, buggy }, 200, {
        "Cache-Control": "public, max-age=" + CACHE_TTL,
    });
    // Store a clone; the Cache API needs a cacheable (non no-store) response.
    if (waitUntil) waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
}
