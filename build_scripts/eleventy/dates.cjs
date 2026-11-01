// Git-based last-modified dates, kept fresh by the pre-commit hook (update-page-dates.cjs).
// Same source the sitemap uses. Keyed by repo-root-relative path, e.g. "src/index.html".
let lastmodCache = {};
try {
    lastmodCache = require("../lastmod-cache.json");
} catch {
    console.warn("lastmod-cache.json not found; footer 'last updated' dates will be omitted.");
}

// Commits-per-file ("edit count"), from the same script as lastmodCache.
let editcountCache = {};
try {
    editcountCache = require("../editcount-cache.json");
} catch {
    console.warn("editcount-cache.json not found; stats page edit counts will be omitted.");
}

// Initial-release dates. Unlike the two caches above these can't be rebuilt from
// git, so they are only added to. Pages absent from it render no release date.
let releaseCache = {};
try {
    releaseCache = require("../release-dates.json");
} catch {
    console.warn("release-dates.json not found; footer release dates will be omitted.");
}

/** "2026-05-11" -> "May 11, 2026". In UTC, so the build's timezone can't shift the day. */
function formatCalendarDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    });
}

/** Normalize a page's inputPath ("./src/index.html") to a cache key ("src/index.html"). */
function cacheKeyFor(inputPath) {
    return inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * "2026-05-11" -> "3 days ago" / "last month" / "2 years ago".
 *
 * Baked in at build time, so it would drift as the deploy ages; ui/footer.ts
 * re-renders it in the browser against the reader's own clock. Keep this bucket
 * ladder and the one there in sync, or pages visibly reword when the script runs.
 */
const relativeFmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function formatRelativeDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const now = new Date();
    // Compare calendar date to calendar date, both sides pinned to UTC noon so
    // no timezone or DST shift can nudge the difference across a day boundary.
    const then = Date.UTC(y, m - 1, d);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.max(0, Math.round((today - then) / 86400000));

    if (days < 1) return "today";
    if (days < 7) return relativeFmt.format(-days, "day");
    if (days < 31) return relativeFmt.format(-Math.round(days / 7), "week");
    if (days < 365) return relativeFmt.format(-Math.max(1, Math.round(days / 30.44)), "month");
    return relativeFmt.format(-Math.max(1, Math.round(days / 365.25)), "year");
}

module.exports = { lastmodCache, editcountCache, releaseCache, formatCalendarDate, cacheKeyFor, formatRelativeDate };
