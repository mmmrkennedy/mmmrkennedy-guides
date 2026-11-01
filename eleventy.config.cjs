const { lastmodCache, editcountCache, releaseCache, formatCalendarDate, cacheKeyFor, formatRelativeDate } = require("./build_scripts/eleventy/dates.cjs");
const { WORDCOUNT_FLOOR, countWords, siteStats, resetStats } = require("./build_scripts/eleventy/stats.cjs");
const { classifyLinks, unlinkUnwrittenGuides } = require("./build_scripts/eleventy/links.cjs");
const { domPass } = require("./build_scripts/eleventy/dom-pass.cjs");
const { injectReactBundle, prerenderSolvers } = require("./build_scripts/eleventy/solvers.cjs");
const { smartCopyImages } = require("./build_scripts/eleventy/copy-images.cjs");

module.exports = function(eleventyConfig) {
    // classifyLinks first: it must not see the tables of contents domPass builds.
    eleventyConfig.addTransform("classifyLinks", classifyLinks);
    eleventyConfig.addTransform("domPass", domPass);
    eleventyConfig.addTransform("injectReactBundle", injectReactBundle);
    eleventyConfig.addTransform("prerenderSolvers", prerenderSolvers);
    eleventyConfig.addTransform("unlinkUnwrittenGuides", unlinkUnwrittenGuides);

    eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

    // Only copies new or changed files.
    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Re-measure every build, or `eleventy --serve` freezes the stats at startup.
    eleventyConfig.on("eleventy.before", resetStats);

    eleventyConfig.addPassthroughCopy("src/css/*");
    eleventyConfig.addPassthroughCopy("src/favicon");
    eleventyConfig.addPassthroughCopy("src/font");
    // Not src/react-solvers: Vite builds that into dist/react-solvers, and copying
    // the source on top would overwrite its output.
    eleventyConfig.addPassthroughCopy("src/_headers");
    eleventyConfig.addPassthroughCopy("src/_redirects");

    eleventyConfig.addGlobalData("permalink", () => {
        return (data) => {
            if (data.page.inputPath.includes(".html")) {
                return data.page.filePathStem + ".html";
            }
            return data.page.url;
        };
    });

    // Strip .html extension from URLs so canonicals match Cloudflare Pretty URLs
    eleventyConfig.addFilter("cleanUrl", (url) => url ? url.replace(/\.html$/, "") : url);

    eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

    // Filters below take a page's inputPath unless noted. "2026-05-11", or "" if unknown.
    eleventyConfig.addFilter("lastmodISO", (inputPath) => {
        if (!inputPath) return "";
        return (lastmodCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // "May 11, 2026".
    eleventyConfig.addFilter("lastmod", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The day the page first went live, or "" if release-dates.json doesn't have it.
    eleventyConfig.addFilter("releasedISO", (inputPath) => {
        if (!inputPath) return "";
        return (releaseCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // "October 9, 2025".
    eleventyConfig.addFilter("released", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Takes an ISO date, not a page path: "2023-07-29" -> "July 29, 2023".
    eleventyConfig.addFilter("calendarDate", (iso) => formatCalendarDate(iso));

    // "3 days ago" / "last month" / "2 years ago".
    eleventyConfig.addFilter("lastmodRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The release date as an age.
    eleventyConfig.addFilter("releasedRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Commits that have touched the page, or null if unknown.
    eleventyConfig.addFilter("editcount", (inputPath) => {
        if (!inputPath) return null;
        return editcountCache[cacheKeyFor(inputPath)] || null;
    });

    // Takes body HTML. Null below the floor, so stubs show no count.
    eleventyConfig.addFilter("wordcount", (html) => {
        const n = countWords(html);
        return n >= WORDCOUNT_FLOOR ? n : null;
    });

    // Per-guide and site-wide measurements, for the index footer and /stats.
    eleventyConfig.addGlobalData("siteWords", () => siteStats().totals);
    eleventyConfig.addGlobalData("stats", siteStats);

    // Bar length as a percentage of the largest value in its chart.
    eleventyConfig.addFilter("pct", (value, max) => (max > 0 ? Math.max(1.5, (value / max) * 100).toFixed(2) : "0"));

    // 4182 -> "4,182". Grouped digits so the footer count stays readable.
    eleventyConfig.addFilter("thousands", (n) =>
        typeof n === "number" ? n.toLocaleString("en-US") : n);

    // `editors` frontmatter (comma-separated or a list) -> "A", "A and B", "A, B, and C".
    eleventyConfig.addFilter("formatEditors", (editors) => {
        const names = (Array.isArray(editors) ? editors : String(editors || "").split(","))
            .map((name) => String(name).trim())
            .filter(Boolean);
        if (names.length === 0) return "";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} and ${names[1]}`;
        return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
    });

    return {
        dir: {
            input: "src",
            output: "dist",
            includes: "_includes",
            data: "_data",
        },
        templateFormats: ["html", "md", "njk"],
        htmlTemplateEngine: "njk",
        markdownTemplateEngine: "njk",
    };
};
