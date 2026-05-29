// Cloudflare Pages Function — per-page view counter backed by Workers KV.
//
// Requires a KV namespace bound as `VIEWS` (Pages → Settings → Functions →
// KV namespace bindings). Routes are served from your own domain:
//
//   GET  /api/views?path=/games/...   → { path, count }   (read only, no increment)
//   POST /api/views?path=/games/...   → { path, count }   (increment, returns new total)
//
// Counts start at 0 the first time a path is seen — there is no historical
// backfill (see notes in the guide footer feature).

const KEY_PREFIX = "views:";
const MAX_PATH_LENGTH = 512;

// Accept only same-site absolute paths; reject schemes, hosts, and traversal.
function normalizePath(raw) {
    if (!raw) return null;
    let p = raw.trim();
    if (!p.startsWith("/") || p.includes("://") || p.includes("..")) return null;
    p = p.split(/[?#]/)[0]; // drop any query/hash
    if (p.length > 1) p = p.replace(/\/+$/, ""); // collapse trailing slash, keep root "/"
    if (p.length > MAX_PATH_LENGTH) return null;
    return p;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

async function readCount(env, path) {
    const raw = await env.VIEWS.get(KEY_PREFIX + path);
    const n = parseInt(raw ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function onRequestGet({ request, env }) {
    if (!env.VIEWS) return json({ error: "KV binding 'VIEWS' is not configured" }, 500);
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);
    return json({ path, count: await readCount(env, path) });
}

export async function onRequestPost({ request, env }) {
    if (!env.VIEWS) return json({ error: "KV binding 'VIEWS' is not configured" }, 500);
    const path = normalizePath(new URL(request.url).searchParams.get("path"));
    if (!path) return json({ error: "invalid or missing 'path'" }, 400);
    // KV is eventually consistent: a get-then-put can lose a tick under heavy
    // concurrency. Fine for a vanity counter; use D1/Durable Objects if exact.
    const next = (await readCount(env, path)) + 1;
    await env.VIEWS.put(KEY_PREFIX + path, String(next));
    return json({ path, count: next });
}
