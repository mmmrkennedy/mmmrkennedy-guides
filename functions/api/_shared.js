// Shared helpers for the Pages Functions API.
//
// Files prefixed with "_" are NOT turned into routes by Cloudflare Pages
// Functions, so this module is import-only. Used by the view counter and the
// feedback (flag) handlers.

const MAX_PATH_LENGTH = 512;

// Accept only same-site absolute paths; reject schemes, hosts, and traversal.
// Mirrors the client-side normalizePath in view-counter.ts / line-flagger.ts so
// a path stored by one endpoint matches a lookup from another.
export function normalizePath(raw) {
    if (!raw) return null;
    let p = raw.trim();
    if (!p.startsWith("/") || p.includes("://") || p.includes("..")) return null;
    p = p.split(/[?#]/)[0]; // drop any query/hash
    if (p.length > 1) p = p.replace(/\/+$/, ""); // collapse trailing slash, keep root "/"
    if (p.length > MAX_PATH_LENGTH) return null;
    return p;
}

export function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...extraHeaders,
        },
    });
}

// Push a notification to ntfy.sh when a new flag lands. Best-effort: gated on the
// NTFY_TOPIC secret being set, and any failure is swallowed so a notification
// problem can never affect the flag write. Call via waitUntil so it never blocks
// the response. The topic name IS the secret (anyone who knows it can read the
// notifications), so keep it unguessable.
export async function notifyFlag(env, request, flag) {
    const topic = env && env.NTFY_TOPIC;
    if (!topic) return; // notifications disabled (e.g. local/dev)

    let click = "";
    try {
        click = new URL(request.url).origin + "/admin/flags";
    } catch {
        // request.url unavailable — notification just won't have a tap target
    }

    const payload = {
        topic,
        title: `New flag: ${flag.reason}`,
        message: `${flag.path}\n"${flag.quote || "(no quote)"}"\n— ${flag.detail}`,
        tags: ["triangular_flag_on_post"],
        priority: 4, // high — buzzes the phone
    };
    if (click) payload.click = click;

    const headers = { "Content-Type": "application/json" };
    // Publish authenticated so ntfy's rate limit is tied to the account, not the
    // shared Cloudflare egress IP — whose anonymous daily quota is perpetually
    // exhausted by everyone else publishing from Workers (causes 429s).
    if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;

    try {
        const res = await fetch("https://ntfy.sh", {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.error(`notifyFlag: ntfy rejected — ${res.status} ${text}`);
        }
    } catch (err) {
        console.error("notifyFlag: fetch threw —", (err && err.message) || err);
        // best-effort; never throw out of a notification
    }
}

// One-way hash of the client IP. Salted with FEEDBACK_IP_SALT (set as a secret)
// so the stored value can't be reversed back to an IP, while staying stable for
// dedupe / rate-limit triage. Returns null if no IP is available.
export async function hashIp(request, env) {
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip) return null;
    const salt = (env && env.FEEDBACK_IP_SALT) || "";
    const data = new TextEncoder().encode(salt + "|" + ip);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
}
