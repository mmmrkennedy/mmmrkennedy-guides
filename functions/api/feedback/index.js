// Lines whose open "buggy" reports from distinct IPs cross THRESHOLD, for the
// client's caution note. Edge-cached via the Cache API to keep D1 reads near zero.

import { normalizePath, json } from "../_shared.js";

const THRESHOLD = 5;
const CACHE_TTL = 300; // seconds

export async function onRequestGet({ request, env, waitUntil }) {
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);

    // Must never break the page, so degrade instead of erroring.
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
        // Not cached, so a transient error doesn't stick.
        return json({ path, buggy: [] }, 200);
    }

    const resp = json({ path, buggy }, 200, {
        "Cache-Control": "public, max-age=" + CACHE_TTL,
    });
    // The Cache API needs a cacheable (non no-store) response.
    if (waitUntil) waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
}
