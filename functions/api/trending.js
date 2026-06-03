// GET /api/trending
// Pages ranked by views over the last 7 days (from the D1 `view_days` table), so
// the home page can flag the most-viewed guide and most-viewed solver. Returns
// just the ranking; the client classifies guide vs solver from the index links
// (which is reliable even where paths don't follow naming conventions).
//
// Response: { window_days, ranked: [ { path, count } ] }, edge-cached ~1h.

import { json } from "./_shared.js";

const WINDOW_DAYS = 7;
const CACHE_TTL = 3600; // seconds
const LIMIT = 150;

export async function onRequestGet({ request, env, waitUntil }) {
    // Public read that must never break the page: with no DB, return empty.
    if (!env.DB) return json({ window_days: WINDOW_DAYS, ranked: [] }, 200);

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const since = new Date(Date.now() - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);

    let ranked = [];
    try {
        const { results } = await env.DB.prepare(
            "SELECT path, SUM(count) AS c FROM view_days WHERE day >= ?1 " +
                "GROUP BY path ORDER BY c DESC LIMIT ?2",
        )
            .bind(since, LIMIT)
            .all();
        ranked = (results || []).map((r) => ({ path: r.path, count: r.c }));
    } catch {
        // view_days not created yet, or query error — no trending, no noise.
        return json({ window_days: WINDOW_DAYS, ranked: [] }, 200);
    }

    const resp = json({ window_days: WINDOW_DAYS, ranked }, 200, {
        "Cache-Control": "public, max-age=" + CACHE_TTL,
    });
    if (waitUntil) waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
}
