// The "_" prefix keeps Cloudflare Pages Functions from routing this file.

const MAX_PATH_LENGTH = 512;

// Mirrors normalizePath in footer.ts / line-flagger.ts; keep them in step.
export function normalizePath(raw) {
    if (!raw) return null;
    let p = raw.trim();
    if (!p.startsWith("/") || p.includes("://") || p.includes("..")) return null;
    p = p.split(/[?#]/)[0];
    if (p.length > 1) p = p.replace(/\/+$/, "");
    if (p.length > MAX_PATH_LENGTH) return null;
    return p;
}

// Preview deploys share every binding with production (top-level wrangler.toml
// bindings), so writes are gated by host. An allowlist so unknown hosts fail closed.
const PRODUCTION_HOSTS = new Set(["mmmrkennedy.com", "www.mmmrkennedy.com"]);

export function isProductionHost(url) {
    return PRODUCTION_HOSTS.has(url.hostname);
}

// The view counter refuses these; reading analytics stores them tagged `prev = 1`.
// localhost is safe: a deployed Function only sees the zone's hostname.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isPreviewHost(url) {
    return url.hostname.endsWith(".pages.dev") || LOCAL_HOSTS.has(url.hostname);
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

// Best-effort; call via waitUntil. Telegram, not ntfy: ntfy rate-limits the
// Workers' shared egress IPs.
export async function notifyFlag(env, request, flag) {
    const token = env && env.TELEGRAM_BOT_TOKEN;
    const chatId = env && env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    let adminUrl = "";
    try {
        adminUrl = new URL(request.url).origin + "/admin/flags";
    } catch {
        // send without the admin link
    }

    // No parse_mode, so guide content can't break Markdown/HTML parsing.
    const lines = [
        flag.solver ? `🧩 New solver flag: ${flag.reason} (${flag.solver})` : `🚩 New flag: ${flag.reason}`,
        flag.path,
        `"${flag.quote || "(no quote)"}"`,
        `- ${flag.detail}`,
    ];
    if (flag.expected) lines.push(`Expected: ${flag.expected}`);
    if (adminUrl) lines.push(adminUrl);

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: lines.join("\n"),
                disable_web_page_preview: true,
            }),
        });
        if (!res.ok) {
            // Never log the URL: it contains the bot token.
            const body = await res.text().catch(() => "");
            console.error(`notifyFlag: telegram rejected — ${res.status} ${body}`);
        }
    } catch (err) {
        console.error("notifyFlag: telegram fetch threw —", (err && err.message) || err);
    }
}

// Salted with the FEEDBACK_IP_SALT secret so it can't be reversed, but stays
// stable for dedupe.
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
