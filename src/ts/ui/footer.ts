import { log } from "../core/logger";

/**
 * Relative time
 * -------------
 * Re-renders the footer's ages against the reader's own clock: the visible
 * "Updated 3 days ago", and the "Released 2 years ago" tooltip on the initial
 * release date.
 *
 * The build bakes both strings into the page (see the `lastmodRelative` and
 * `releasedRelative` filters in eleventy.config.cjs), but that text ages with the
 * deploy: a guide edited yesterday still reads "yesterday" three weeks later. This
 * reads the machine-readable `datetime` attribute and rewrites on load, so the
 * baked-in string only ever shows to readers without JS.
 *
 * The release date itself is absolute and never rewritten; only the tooltip that
 * says how long ago it was.
 *
 * The bucket ladder here must match `formatRelativeDate` in build_scripts/eleventy/dates.cjs,
 * or pages would visibly flip wording the moment the script runs.
 */
document.addEventListener("DOMContentLoaded", () => {
    const updated = document.querySelectorAll<HTMLTimeElement>("time[datetime].site-footer__updated");
    const released = document.querySelectorAll<HTMLTimeElement>("time[datetime].site-footer__released");
    if (updated.length === 0 && released.length === 0) return;

    const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

    updated.forEach((node) => {
        const days = daysSince(node.dateTime);
        if (days === null) return;
        node.textContent = "Updated " + relative(days);
    });

    released.forEach((node) => {
        const days = daysSince(node.dateTime);
        if (days === null) return;
        node.title = "Released " + relative(days);
    });

    /**
     * Whole days between a "YYYY-MM-DD" attribute and the reader's local calendar
     * date. Both sides are reinterpreted as UTC so the subtraction is pure date
     * arithmetic, so no timezone offset or DST hour can shift the result by a day.
     * Null if the attribute isn't a bare calendar date.
     */
    function daysSince(datetime: string): number | null {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime);
        if (!match) return null;
        const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const now = new Date();
        const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.max(0, Math.round((today - then) / 86400000));
    }

    /** 0 → "today", 3 → "3 days ago", 40 → "last month". */
    function relative(days: number): string {
        if (days < 1) return "today";
        if (days < 7) return fmt.format(-days, "day");
        if (days < 31) return fmt.format(-Math.round(days / 7), "week");
        if (days < 365) return fmt.format(-Math.max(1, Math.round(days / 30.44)), "month");
        return fmt.format(-Math.max(1, Math.round(days / 365.25)), "year");
    }
});

/**
 * View counter
 * ------------
 * Fetches the per-page hit count from the /api/views Pages Function (KV-backed)
 * and renders it into the footer's `.site-footer__views` placeholder.
 *
 * Increments once per browser session per path (sessionStorage); on later loads
 * it only reads, so refreshing a page does not inflate its count. Fails silently
 * (the placeholder stays empty and hidden) if the endpoint is unreachable.
 */
document.addEventListener("DOMContentLoaded", () => {
    const target = document.querySelector<HTMLElement>(".site-footer__views");
    if (!target) return;

    // No /api/views backend on the local dev server — skip the fetch entirely
    // so it doesn't 404. The placeholder stays empty/hidden, same as a failure.
    if (isLocalHost()) return;

    const path = normalizePath(window.location.pathname);
    const sessionKey = "viewed:" + path;
    // First sighting this session → POST (increments). Afterwards → GET (read only).
    const shouldIncrement = !sessionStorage.getItem(sessionKey);
    const endpoint = "/api/views?path=" + encodeURIComponent(path);

    fetch(endpoint, { method: shouldIncrement ? "POST" : "GET" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { count?: number }) => {
            if (typeof data.count !== "number") return;
            if (shouldIncrement) {
                try {
                    sessionStorage.setItem(sessionKey, "1");
                } catch {
                    /* sessionStorage blocked (private mode) — skip dedupe, no-op */
                }
            }
            const noun = data.count === 1 ? "view" : "views";
            // Non-empty text lifts the `:empty { display:none }` rule and reveals
            // the leading "•" separator drawn via ::before.
            target.textContent = formatCount(data.count) + " " + noun;
        })
        .catch((err) => {
            log("warn", "View counter unavailable:", err);
        });

    /** True on the local dev server, where no /api/views Pages Function exists. */
    function isLocalHost(): boolean {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    }

    /** Mirror the server's normalization: leading slash, no trailing slash (except root). */
    function normalizePath(p: string): string {
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p;
    }

    /** 1400000 → "1.4M", 12300 → "12.3K", 950 → "950". Drops a trailing ".0". */
    function formatCount(n: number): string {
        const units = [
            { value: 1000000000, suffix: "B" },
            { value: 1000000, suffix: "M" },
            { value: 1000, suffix: "K" },
        ];
        for (const u of units) {
            if (n >= u.value) {
                return (n / u.value).toFixed(1).replace(/\.0$/, "") + u.suffix;
            }
        }
        return String(n);
    }
});
