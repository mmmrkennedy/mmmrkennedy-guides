// Per-page view counter. Requires a D1 database bound as `DB`
// (Pages → Settings → Functions → D1 bindings). Response shape is read by
// src/ts/ui/footer.ts.

import { normalizePath, json, isProductionHost } from "./_shared.js";

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
    const url = new URL(request.url);
    const path = normalizePath(url.searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);

    // Previews show the real count without adding to it. footer.ts ignores `counted`.
    if (!isProductionHost(url)) {
        return json({ path, count: await readCount(env, path), counted: false });
    }

    const row = await env.DB.prepare(
        "INSERT INTO views (path, count) VALUES (?1, 1) " +
            "ON CONFLICT(path) DO UPDATE SET count = count + 1 " +
            "RETURNING count",
    )
        .bind(path)
        .first();

    // Best-effort: the total above must succeed even if view_days isn't migrated.
    const day = new Date().toISOString().slice(0, 10); // UTC
    try {
        await env.DB.prepare(
            "INSERT INTO view_days (path, day, count) VALUES (?1, ?2, 1) " +
                "ON CONFLICT(path, day) DO UPDATE SET count = count + 1",
        )
            .bind(path, day)
            .run();
    } catch {
        /* ignore */
    }

    return json({ path, count: row ? row.count : 1 });
}
