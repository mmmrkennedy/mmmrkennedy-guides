// Kept fresh by the pre-commit hook (update-page-dates.cjs). Keyed by repo-root-relative path.
let lastmodCache = {};
try {
    lastmodCache = require("../lastmod-cache.json");
} catch {
    console.warn("lastmod-cache.json not found; footer 'last updated' dates will be omitted.");
}

// Commits per file, from the same script as lastmodCache.
let editcountCache = {};
try {
    editcountCache = require("../editcount-cache.json");
} catch {
    console.warn("editcount-cache.json not found; stats page edit counts will be omitted.");
}

// Unlike the caches above, these can't be rebuilt from git, so they are only added to.
let releaseCache = {};
try {
    releaseCache = require("../release-dates.json");
} catch {
    console.warn("release-dates.json not found; footer release dates will be omitted.");
}

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

function cacheKeyFor(inputPath) {
    return inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * ui/footer.ts re-renders this in the browser so it doesn't drift as the deploy
 * ages. Keep the bucket ladders in sync, or pages visibly reword on load.
 */
const relativeFmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function formatRelativeDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const now = new Date();
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
