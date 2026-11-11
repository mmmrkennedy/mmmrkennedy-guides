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
    // Both Vite watchers write .solver-ssr/ under `dev:watch`; watching it rebuilds
    // pages against new chunk hashes. It is gitignored, and Eleventy won't watch
    // gitignored paths, so .gitignore is not read (no page template relies on it).
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

    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Re-measure every build, or `eleventy --serve` freezes the stats at startup.
    eleventyConfig.on("eleventy.before", resetStats);

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

    eleventyConfig.addCollection("solverPages", solverPages);
    eleventyConfig.addCollection("solverIndex", solverIndex);
    eleventyConfig.addFilter("solverSpokes", solverSpokes);

    // Canonicals must match Cloudflare Pretty URLs
    eleventyConfig.addFilter("cleanUrl", (url) => url ? url.replace(/\.html$/, "") : url);

    eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

    // Filters below take a page's inputPath unless noted.
    eleventyConfig.addFilter("lastmodISO", (inputPath) => {
        if (!inputPath) return "";
        return (lastmodCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    eleventyConfig.addFilter("lastmod", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // From release-dates.json.
    eleventyConfig.addFilter("releasedISO", (inputPath) => {
        if (!inputPath) return "";
        return (releaseCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    eleventyConfig.addFilter("released", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Takes an ISO date, not a page path.
    eleventyConfig.addFilter("calendarDate", (iso) => formatCalendarDate(iso));

    eleventyConfig.addFilter("lastmodRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    eleventyConfig.addFilter("releasedRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Takes body HTML. Null below the floor, so stubs show no count.
    eleventyConfig.addFilter("wordcount", (html) => {
        const n = countWords(html);
        return n >= WORDCOUNT_FLOOR ? n : null;
    });

    eleventyConfig.addGlobalData("siteWords", () => siteStats().totals);
    eleventyConfig.addGlobalData("stats", siteStats);

    eleventyConfig.addFilter("pct", (value, max) => (max > 0 ? Math.max(1.5, (value / max) * 100).toFixed(2) : "0"));

    eleventyConfig.addFilter("thousands", (n) =>
        typeof n === "number" ? n.toLocaleString("en-US") : n);

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
