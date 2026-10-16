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

// Hostnames whose traffic is the real thing. Preview deployments share every
// binding with production — top-level bindings in wrangler.toml apply to both
// environments — so without this split every page opened on
// preview.<project>.pages.dev, or on any per-commit preview URL, would inflate
// the real view counter and the "trending this week" ranking built from it.
//
// An allowlist rather than a *.pages.dev blocklist: a hostname nobody
// anticipated should fail closed, not quietly start writing.
const PRODUCTION_HOSTS = new Set(["mmmrkennedy.com", "www.mmmrkennedy.com"]);

export function isProductionHost(url) {
    return PRODUCTION_HOSTS.has(url.hostname);
}

// Preview deploys, plus `wrangler pages dev`. The two writers treat these
// differently on purpose: the view counter refuses them outright (there is one
// public number and a test must not move it), while reading analytics stores
// them tagged `prev = 1`, so the whole pipeline can be exercised on a preview
// URL or locally, and the dashboard still hides the test traffic by default.
//
// localhost is safe to include: a deployed Function only ever sees the zone's
// hostname, so the only way to hit this branch in production is to spoof the
// Host header, and the reward for that is a row nobody looks at.
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

// Send a Telegram message when a new flag lands. Best-effort: disabled unless
// BOTH TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, and any failure is logged
// but swallowed so a notification problem never affects the flag write. Call via
// waitUntil so it never blocks the response. Unlike ntfy, Telegram authenticates
// by bot token, so there's no shared-egress-IP rate limit to trip over.
export async function notifyFlag(env, request, flag) {
    const token = env && env.TELEGRAM_BOT_TOKEN;
    const chatId = env && env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return; // notifications disabled (e.g. local/dev)

    let adminUrl = "";
    try {
        adminUrl = new URL(request.url).origin + "/admin/flags";
    } catch {
        // request.url unavailable — message just won't carry the admin link
    }

    // Plain text (no parse_mode) so guide content can't break Markdown/HTML
    // parsing. Telegram auto-links the bare URL.
    //
    // For a solver flag the quote is a one-line dump of the inputs and the answer
    // it gave, so the message alone is usually enough to tell a real bug from a
    // mis-entered round without opening the admin page.
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
            // Body carries Telegram's reason (e.g. "chat not found", "Unauthorized").
            // Never log the URL — it contains the bot token.
            const body = await res.text().catch(() => "");
            console.error(`notifyFlag: telegram rejected — ${res.status} ${body}`);
        }
    } catch (err) {
        console.error("notifyFlag: telegram fetch threw —", (err && err.message) || err);
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
