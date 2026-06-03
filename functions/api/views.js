// Cloudflare Pages Function — per-page view counter backed by D1.
//
// Migrated off Workers KV (which was nearing its 1,000 writes/day free-tier cap)
// onto D1. Requires a D1 database bound as `DB` (Pages → Settings → Functions →
// D1 bindings). Routes are served from your own domain:
//
//   GET  /api/views?path=/games/...   → { path, count }   (read only, no increment)
//   POST /api/views?path=/games/...   → { path, count }   (increment, returns new total)
//
// The POST increment is a single atomic upsert (INSERT ... ON CONFLICT DO UPDATE
// ... RETURNING count), which removes the read-modify-write race the KV version
// had. Existing KV counts are backfilled once via build_scripts/migrate-kv-to-d1.js.
//
// The response contract is unchanged from the KV version, so the front-end
// (src/ts/ui/view-counter.ts) needs no changes.

import { normalizePath, json } from "./_shared.js";

async function readCount(env, path) {
    const row = await env.DB.prepare("SELECT count FROM views WHERE path = ?1").bind(path).first();
    const n = row && row.count;
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function onRequestGet({ request, env }) {
    if (!env.DB) return json({ error: "D1 binding 'DB' is not configured" }, 500);
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);
    return json({ path, count: await readCount(env, path) });
}

export async function onRequestPost({ request, env }) {
    if (!env.DB) return json({ error: "D1 binding 'DB' is not configured" }, 500);
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);
    const row = await env.DB.prepare(
        "INSERT INTO views (path, count) VALUES (?1, 1) " +
            "ON CONFLICT(path) DO UPDATE SET count = count + 1 " +
            "RETURNING count",
    )
        .bind(path)
        .first();

    // Also bump today's per-day bucket for "trending / popular this week".
    // Best-effort: if the view_days table doesn't exist yet, the total counter
    // above must still succeed, so swallow any error here.
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    try {
        await env.DB.prepare(
            "INSERT INTO view_days (path, day, count) VALUES (?1, ?2, 1) " +
                "ON CONFLICT(path, day) DO UPDATE SET count = count + 1",
        )
            .bind(path, day)
            .run();
    } catch {
        /* view_days not migrated yet — ignore */
    }

    return json({ path, count: row ? row.count : 1 });
}
