const { lastmodCache, editcountCache, releaseCache, formatCalendarDate, cacheKeyFor, formatRelativeDate } = require("./build_scripts/eleventy/dates.cjs");
const { WORDCOUNT_FLOOR, countWords, siteStats, resetStats } = require("./build_scripts/eleventy/stats.cjs");
const { classifyLinks, unlinkUnwrittenGuides } = require("./build_scripts/eleventy/links.cjs");
const { domPass } = require("./build_scripts/eleventy/dom-pass.cjs");
const { injectReactBundle, prerenderSolvers } = require("./build_scripts/eleventy/solvers.cjs");
const { smartCopyImages } = require("./build_scripts/eleventy/copy-images.cjs");

module.exports = function(eleventyConfig) {
    // Add transforms for quick links generation, link classification, versioning, and React bundle injection
    // classifyLinks first: it must not see the tables of contents domPass builds.
    eleventyConfig.addTransform("classifyLinks", classifyLinks);
    eleventyConfig.addTransform("domPass", domPass);
    eleventyConfig.addTransform("injectReactBundle", injectReactBundle);
    eleventyConfig.addTransform("prerenderSolvers", prerenderSolvers);
    eleventyConfig.addTransform("unlinkUnwrittenGuides", unlinkUnwrittenGuides);

    // Performance optimization: use passthrough for dev server (faster)
    eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

    // Smart image copy: only copies new or changed files
    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Re-measure every build. Without this the cache is filled once and never
    // again, so under `eleventy --serve` the stats page and the index footer
    // freeze at whatever the numbers were when the server started.
    eleventyConfig.on("eleventy.before", resetStats);

    // Passthrough copy static assets (non-image)
    eleventyConfig.addPassthroughCopy("src/css/*");
    eleventyConfig.addPassthroughCopy("src/favicon");
    eleventyConfig.addPassthroughCopy("src/font");
    // NOT src/react-solvers — Vite already builds that directory into
    // dist/react-solvers (see vite.config.js `outDir`), and it runs before
    // Eleventy. Copying the source tree on top of it published every solver's
    // .tsx source plus a stale nested dist/ (bundle + 1.2MB sourcemap) to the
    // live site, and overwrote Vite's built index.html with the source one that
    // points at /src/main.tsx. Production needs only Vite's assets/ output.
    eleventyConfig.addPassthroughCopy("src/_headers");
    eleventyConfig.addPassthroughCopy("src/_redirects");

    // Preserve .html file extensions instead of using directory index
    eleventyConfig.addGlobalData("permalink", () => {
        return (data) => {
            // Keep the exact file path with .html extension
            if (data.page.inputPath.includes(".html")) {
                return data.page.filePathStem + ".html";
            }
            return data.page.url;
        };
    });

    // Strip .html extension from URLs so canonicals match Cloudflare Pretty URLs
    eleventyConfig.addFilter("cleanUrl", (url) => url ? url.replace(/\.html$/, "") : url);

    // Add a shortcode for the current year (useful for copyright)
    eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

    // Given a page's inputPath (e.g. "./src/index.html"), return the bare calendar
    // date git recorded for it ("2026-05-11"). Empty string if unknown.
    eleventyConfig.addFilter("lastmodISO", (inputPath) => {
        if (!inputPath) return "";
        return (lastmodCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // Same date formatted like "May 11, 2026", for the footer's hover tooltip.
    eleventyConfig.addFilter("lastmod", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The day the page first went live, from release-dates.json. Empty string for
    // anything not in there (an unreleased guide, a solver that never had its own
    // launch, the index), so the footer skips it rather than inventing a date.
    eleventyConfig.addFilter("releasedISO", (inputPath) => {
        if (!inputPath) return "";
        return (releaseCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // Same date as "October 9, 2025". Absolute, not relative like `Updated`: a
    // first-release date is a fact about the page, not news about it.
    eleventyConfig.addFilter("released", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // "2023-07-29" -> "July 29, 2023", for dates that arrive as bare ISO strings
    // rather than as a page path (the stats page's aggregates).
    eleventyConfig.addFilter("calendarDate", (iso) => formatCalendarDate(iso));

    // Same date as "3 days ago" / "last month" / "2 years ago", for the footer's
    // visible text.
    eleventyConfig.addFilter("lastmodRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The release date as an age, for the footer's hover tooltip. The visible
    // text is the absolute date, so the tooltip carries what that date means now.
    eleventyConfig.addFilter("releasedRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Given a page's inputPath, return how many commits have touched it (its
    // "edit count") from editcount-cache.json. Null if unknown, so the template
    // can skip rendering rather than show "0 edits".
    eleventyConfig.addFilter("editcount", (inputPath) => {
        if (!inputPath) return null;
        return editcountCache[cacheKeyFor(inputPath)] || null;
    });

    // Word count of a page's own body HTML, for the footer. Counts the content
    // as authored: transforms (quick links, table wrappers) all run after the
    // layout renders, so none of that chrome is in
    // this string to inflate the number. Returns null below a floor so solver
    // shells and stubs render no count at all rather than "12 words".
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

    // Format a guide's `editors` frontmatter (a comma-separated string or a
    // list) into a grammatical English list: "A", "A and B", "A, B, and C".
    // Empty string if there are no editors, so the footer can skip it.
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
            input: "src", // Read from src
            output: "dist", // Output to dist
            includes: "_includes", // Layout templates
            data: "_data", // Data files
        },
        templateFormats: ["html", "md", "njk"],
        htmlTemplateEngine: "njk", // Use Nunjucks for HTML
        markdownTemplateEngine: "njk",
    };
};
