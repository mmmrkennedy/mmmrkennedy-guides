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
