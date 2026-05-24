#!/usr/bin/env node
/**
 * generate-sitemap.cjs
 *
 * Run on Cloudflare Pages CI as part of the normal build.
 * Reads build_scripts/lastmod-cache.json (kept fresh by GitHub Actions).
 * Does NOT require git history.
 *
 * Usage: node build_scripts/generate-sitemap.cjs
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { SitemapStream, streamToPromise } = require("sitemap");

const SITE_URL = "https://mmmrkennedy.com";
const INDEX_FILE = path.resolve("./dist/index.html");
const INDEX_SOURCE = path.resolve("./src/index.html");
const OUTPUT_FILE = path.resolve("./dist/sitemap.xml");
const LASTMOD_CACHE = path.resolve(__dirname, "lastmod-cache.json");

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(LASTMOD_CACHE, "utf8"));
    } catch {
        console.warn(`Could not read ${path.basename(LASTMOD_CACHE)} — lastmod dates will be omitted.`);
        return {};
    }
}

async function buildSitemap() {
    if (!fs.existsSync(INDEX_FILE)) {
        console.error(`Index file not found: ${INDEX_FILE}`);
        process.exit(1);
    }

    const html = fs.readFileSync(INDEX_FILE, "utf8");
    const dom = new JSDOM(html);

    const IMAGE_EXTENSIONS = /\.(webp|png|jpg|jpeg|gif|svg|avif|ico)$/i;

    const links = Array.from(dom.window.document.querySelectorAll("a"))
        .filter((a) => !a.classList.contains("disabled"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => href && !href.startsWith("http") && !href.startsWith("#"))
        .filter((href) => !IMAGE_EXTENSIONS.test(href))
        .map((href) => href.replace(/^\/?/, ""))
        .map((href) => href.replace(/\?.*$/, ""))
        .map((href) => href.replace(/\.html$/, ""));

    const uniqueLinks = [...new Set(links)];

    if (uniqueLinks.length === 0) {
        console.error("No valid links found in index.html");
        process.exit(1);
    }

    const repoRoot = path.resolve(".");
    const dates = readCache();

    const lastmodFor = (filePath) => {
        const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
        return dates[rel] || null;
    };

    const sitemap = new SitemapStream({ hostname: SITE_URL });

    const homepageSource = fs.existsSync(INDEX_SOURCE) ? INDEX_SOURCE : INDEX_FILE;
    const homepageDate = lastmodFor(homepageSource);
    sitemap.write({ url: "/", ...(homepageDate && { lastmod: homepageDate }) });

    let written = 0;
    let missingCache = 0;

    for (const link of uniqueLinks) {
        const candidates = [
            path.resolve("./src", `${link}.html`),
            path.resolve("./src", link, "index.html"),
            path.resolve("./src", link),
        ];
        const filePath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (filePath) {
            const lastmod = lastmodFor(filePath);
            if (!lastmod) missingCache++;
            sitemap.write({ url: `/${link}`, ...(lastmod && { lastmod }) });
            written++;
        }
    }

    sitemap.end();
    const data = await streamToPromise(sitemap);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, data.toString());

    console.log(`sitemap.xml generated with ${written + 1} pages (homepage + ${written} linked).`);
    if (missingCache > 0) {
        console.warn(`${missingCache} pages had no cache entry — lastmod omitted. Run refresh-lastmod-cache.cjs via GitHub Actions.`);
    }
}

buildSitemap();
