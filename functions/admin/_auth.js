// Shared auth for the /admin/* Pages Functions.
//
// Replaces HTTP Basic Auth with a signed session cookie so the sign-in step is a
// real HTML form (see functions/admin/login.js) that password managers can fill.
//
// The cookie is `<base64url(payload)>.<base64url(hmac)>` where payload is
// `<expiry-epoch-seconds>|<username>`. It is signed with a key derived from
// ADMIN_USER + ADMIN_PASS, so changing the password invalidates every existing
// session. Nothing is stored server-side.
//
// Files prefixed with "_" are not turned into routes by Pages Functions, so this
// module is import-only.

export const COOKIE_NAME = "admin_session";
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days
export const LOGIN_PATH = "/admin/login";
export const DEFAULT_AFTER_LOGIN = "/admin/flags";

export function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

export function htmlResponse(body, status = 200, extraHeaders = {}) {
    return new Response(body, {
        status,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
            // Set here rather than relying on src/_headers — that file covers
            // static assets, not Functions responses.
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            ...extraHeaders,
        },
    });
}

export function notConfiguredResponse() {
    return htmlResponse(
        "<!doctype html><meta charset=utf-8><title>Admin not configured</title>" +
            "<h1>Admin not configured</h1><p>Set the ADMIN_USER and ADMIN_PASS environment variables.</p>",
        503,
    );
}

function b64urlEncode(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function sessionKey(env) {
    return crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(`admin-session-v1|${env.ADMIN_USER}|${env.ADMIN_PASS}`),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
    );
}

// Compare two strings without leaking their contents through timing: HMAC both
// under a fresh random key, then compare the fixed-length digests.
export async function safeEqual(a, b) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        crypto.getRandomValues(new Uint8Array(32)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const [x, y] = await Promise.all([
        crypto.subtle.sign("HMAC", key, enc.encode(String(a ?? ""))),
        crypto.subtle.sign("HMAC", key, enc.encode(String(b ?? ""))),
    ]);
    const xa = new Uint8Array(x);
    const ya = new Uint8Array(y);
    let diff = xa.length ^ ya.length;
    for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
    return diff === 0;
}

export function isConfigured(env) {
    return Boolean(env && env.ADMIN_USER && env.ADMIN_PASS);
}

export async function checkCredentials(env, user, pass) {
    // Both comparisons always run so a wrong username costs the same as a wrong password.
    const [userOk, passOk] = await Promise.all([
        safeEqual(user, env.ADMIN_USER),
        safeEqual(pass, env.ADMIN_PASS),
    ]);
    return userOk && passOk;
}

function readCookie(request, name) {
    const header = request.headers.get("Cookie") || "";
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

export async function createSessionToken(env, ttlSeconds = SESSION_TTL_SECONDS) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${exp}|${env.ADMIN_USER}`;
    const key = await sessionKey(env);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    return `${b64urlEncode(new TextEncoder().encode(payload))}.${b64urlEncode(new Uint8Array(sig))}`;
}

// Returns the signed-in username, or null when there is no valid session.
export async function getSession(request, env) {
    if (!isConfigured(env)) return null;
    const token = readCookie(request, COOKIE_NAME);
    if (!token) return null;

    const dot = token.indexOf(".");
    if (dot === -1) return null;

    let payloadBytes;
    let sigBytes;
    try {
        payloadBytes = b64urlDecode(token.slice(0, dot));
        sigBytes = b64urlDecode(token.slice(dot + 1));
    } catch {
        return null;
    }

    const key = await sessionKey(env);
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, payloadBytes);
    if (!valid) return null;

    const payload = new TextDecoder().decode(payloadBytes);
    const sep = payload.indexOf("|");
    if (sep === -1) return null;
    const exp = parseInt(payload.slice(0, sep), 10);
    const user = payload.slice(sep + 1);
    if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
    if (user !== env.ADMIN_USER) return null;
    return user;
}

// `Secure` is skipped over plain http so `wrangler pages dev` still works locally.
function cookieAttributes(request) {
    const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
    // SameSite=Lax keeps the session usable when following a link into the admin
    // (e.g. from the Telegram flag notification) while blocking cross-site POSTs.
    return `Path=/admin; HttpOnly;${secure} SameSite=Lax`;
}

export function sessionCookie(request, token, ttlSeconds = SESSION_TTL_SECONDS) {
    return `${COOKIE_NAME}=${token}; ${cookieAttributes(request)}; Max-Age=${ttlSeconds}`;
}

export function clearedSessionCookie(request) {
    return `${COOKIE_NAME}=; ${cookieAttributes(request)}; Max-Age=0`;
}

// Cross-site POSTs are already blocked by SameSite=Lax; this is the second layer
// for browsers/clients that ignore it. Requests without an Origin (curl, old
// clients) are allowed through — the session cookie is still required.
export function originAllowed(request) {
    const origin = request.headers.get("Origin");
    if (!origin) return true;
    try {
        return new URL(origin).host === new URL(request.url).host;
    } catch {
        return false;
    }
}

// Only same-site absolute /admin/... paths may be used as a post-login target.
export function safeNext(raw) {
    if (!raw) return DEFAULT_AFTER_LOGIN;
    const next = String(raw);
    if (!next.startsWith("/admin/")) return DEFAULT_AFTER_LOGIN;
    if (next.startsWith("//") || next.includes("\\") || next.includes("://")) return DEFAULT_AFTER_LOGIN;
    return next;
}

export function redirect(request, path, extraHeaders = {}) {
    const dest = new URL(path, request.url).href;
    return new Response(null, {
        status: 303,
        headers: { Location: dest, "Cache-Control": "no-store", ...extraHeaders },
    });
}

// Guard for an admin route: returns a Response to send back, or null when the
// request is authenticated and should proceed.
export async function requireSession(request, env) {
    if (!isConfigured(env)) return notConfiguredResponse();
    const user = await getSession(request, env);
    if (user) return null;
    const url = new URL(request.url);
    const next = url.pathname + url.search;
    return redirect(request, `${LOGIN_PATH}?next=${encodeURIComponent(next)}`);
}
