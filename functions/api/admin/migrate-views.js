// TEMPORARY one-time endpoint — copy view counts from the VIEWS KV namespace
// into the D1 `views` table, entirely server-side so no local wrangler is needed.
//
//   GET /api/admin/migrate-views?token=YOUR_MIGRATE_TOKEN
//
// Requires env var MIGRATE_TOKEN (set it in the dashboard) plus the VIEWS (KV)
// and DB (D1) bindings. Returns { ok, migrated, skipped }.
//
// DELETE this file (and the MIGRATE_TOKEN var) after a successful run — see
// docs/feedback-runbook.md.

import { json } from "../_shared.js";

const PREFIX = "views:";
const CHUNK = 100;

export async function onRequestGet({ request, env }) {
    const token = new URL(request.url).searchParams.get("token");
    if (!env.MIGRATE_TOKEN || token !== env.MIGRATE_TOKEN) {
        return json({ error: "forbidden" }, 403);
    }
    if (!env.VIEWS) return json({ error: "KV binding 'VIEWS' is not configured" }, 500);
    if (!env.DB) return json({ error: "D1 binding 'DB' is not configured" }, 500);

    const upsert =
        "INSERT INTO views (path, count) VALUES (?1, ?2) " +
        "ON CONFLICT(path) DO UPDATE SET count = excluded.count";

    let cursor;
    let migrated = 0;
    let skipped = 0;
    let pending = [];

    const flush = async () => {
        if (pending.length === 0) return;
        await env.DB.batch(pending);
        pending = [];
    };

    do {
        const list = await env.VIEWS.list({ prefix: PREFIX, cursor });
        for (const k of list.keys) {
            const path = k.name.slice(PREFIX.length);
            if (!path) {
                skipped++;
                continue;
            }
            const raw = await env.VIEWS.get(k.name);
            const count = parseInt(raw ?? "", 10);
            if (!Number.isFinite(count) || count < 0) {
                skipped++;
                continue;
            }
            pending.push(env.DB.prepare(upsert).bind(path, count));
            migrated++;
            if (pending.length >= CHUNK) await flush();
        }
        cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    await flush();
    return json({ ok: true, migrated, skipped });
}
