const path = require("path");

const STEPS_DIR = path.join(__dirname, "build_scripts", "eleventy") + path.sep;

module.exports = function(eleventyConfig) {
    // Eleventy can't see require() dependencies in an ESM project. Watching the steps
    // reloads this function when one changes, and clearing them from the require
    // cache makes the reload use the edit.
    eleventyConfig.addWatchTarget("./build_scripts/eleventy/", { resetConfig: true });
    for (const id of Object.keys(require.cache)) {
        if (id.startsWith(STEPS_DIR)) delete require.cache[id];
    }

    const { lastmodCache, releaseCache, formatCalendarDate, cacheKeyFor, formatRelativeDate } = require("./build_scripts/eleventy/dates.cjs");
    const { WORDCOUNT_FLOOR, countWords, siteStats, resetStats } = require("./build_scripts/eleventy/stats.cjs");
    const { classifyLinks, unlinkUnwrittenGuides } = require("./build_scripts/eleventy/links.cjs");
    const { domPass } = require("./build_scripts/eleventy/dom-pass.cjs");
    const { injectReactBundle, prerenderSolvers, resetSolverCaches } = require("./build_scripts/eleventy/solvers.cjs");
    // Solver edits under `dev:watch`. Both Vite watchers write into .solver-ssr/
    // (the prerender build, and the browser build's stamp file), and watching it
    // rebuilds the pages against the new chunk hashes and prerender (see
    // solvers.cjs). The two land a few hundred ms apart; Eleventy queues a second
    // rebuild if one arrives mid-build, so pages end up current.
    //
    // .solver-ssr/ is gitignored, and Eleventy won't watch gitignored paths, so it
    // doesn't read .gitignore. That costs nothing: no page template is
    // gitignored, the output folder is ignored regardless, and node_modules is in
    // Eleventy's own defaults.
    eleventyConfig.setUseGitIgnore(false);
    eleventyConfig.addWatchTarget("./.solver-ssr/");
    const { smartCopyImages } = require("./build_scripts/eleventy/copy-images.cjs");
    const { solverPages, solverIndex, solverSpokes } = require("./build_scripts/eleventy/solver-index.cjs");

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

    // Re-read the solver manifest and SSR build every build (see solvers.cjs).
    eleventyConfig.on("eleventy.before", resetSolverCaches);

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

    // Solver listings for /solvers and the map hubs, from each solver page's own
    // front matter. See build_scripts/eleventy/solver-index.cjs.
    eleventyConfig.addCollection("solverPages", solverPages);
    eleventyConfig.addCollection("solverIndex", solverIndex);
    eleventyConfig.addFilter("solverSpokes", solverSpokes);

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
