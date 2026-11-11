import { log } from "../core/logger";

/**
 * The build bakes relative ages in (`lastmodRelative`/`releasedRelative` in
 * eleventy.config.cjs), but that text goes stale after deploy, so re-render here.
 * The buckets must match `formatRelativeDate` in build_scripts/eleventy/dates.cjs,
 * or wording visibly flips on load.
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

    /** Both sides go through UTC so no timezone offset or DST hour shifts the result by a day. */
    function daysSince(datetime: string): number | null {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime);
        if (!match) return null;
        const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const now = new Date();
        const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.max(0, Math.round((today - then) / 86400000));
    }

    function relative(days: number): string {
        if (days < 1) return "today";
        if (days < 7) return fmt.format(-days, "day");
        if (days < 31) return fmt.format(-Math.round(days / 7), "week");
        if (days < 365) return fmt.format(-Math.max(1, Math.round(days / 30.44)), "month");
        return fmt.format(-Math.max(1, Math.round(days / 365.25)), "year");
    }
});

/** View counter: POST (increment) once per session per path, GET after that. */
document.addEventListener("DOMContentLoaded", () => {
    const target = document.querySelector<HTMLElement>(".site-footer__views");
    if (!target) return;

    // No /api/views backend on the local dev server.
    if (isLocalHost()) return;

    const path = normalizePath(window.location.pathname);
    const sessionKey = "viewed:" + path;
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
                    /* sessionStorage blocked: skip dedupe */
                }
            }
            const noun = data.count === 1 ? "view" : "views";
            // Non-empty text lifts the `:empty { display:none }` rule.
            target.textContent = formatCount(data.count) + " " + noun;
        })
        .catch((err) => {
            log("warn", "View counter unavailable:", err);
        });

    function isLocalHost(): boolean {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    }

    /** Must mirror the server's path normalization. */
    function normalizePath(p: string): string {
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p;
    }

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
