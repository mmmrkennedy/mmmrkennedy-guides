#!/usr/bin/env node
/**
 * Runs on Cloudflare Pages CI, which has no git history, so lastmod comes from
 * lastmod-cache.json (kept fresh by the pre-commit hook).
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

// Google's per-URL <image:image> cap; exceeding it invalidates the entry.
const MAX_IMAGES_PER_URL = 1000;
const SITEMAP_IMAGE_EXT = /\.(webp|png|jpg|jpeg|gif)$/i;

// Downscaled variant instead of the master (~133KB vs ~694KB average). The tier is
// allowlisted in functions/games/[[path]].js, and an image with no variant falls
// back to the master, so the URL always resolves.
const SITEMAP_IMAGE_TIER = "?w=1280";

/**
 * Screenshots are lightbox <a href> links, never <img>, so Google Images can't
 * find them in the markup. Reads dist, not src. The image files are usually absent
 * from dist (IMAGES_FROM_R2, served from the bucket), so nothing is checked on disk.
 */
function imagesFor(link) {
    const built = path.resolve("./dist", `${link}.html`);
    if (!fs.existsSync(built)) return [];

    // Pages are served extensionless, so relative hrefs resolve against the
    // page's directory.
    const pageUrl = `${SITE_URL}/${link}`;
    const doc = new JSDOM(fs.readFileSync(built, "utf8")).window.document;
    const found = new Map();

    const add = (href, caption) => {
        if (!href) return;
        let url;
        try {
            url = new URL(href, pageUrl);
        } catch {
            return;
        }
        if (url.origin !== SITE_URL) return;
        if (!url.pathname.startsWith("/games/")) return;
        if (!SITEMAP_IMAGE_EXT.test(url.pathname)) return;

        const clean = SITE_URL + url.pathname;
        if (found.has(clean)) return;

        const text = (caption || "").replace(/\s+/g, " ").trim();
        found.set(clean, { url: clean + SITEMAP_IMAGE_TIER, ...(text && text.length <= 200 && { caption: text }) });
    };

    // Anchor text is the author's caption for the screenshot.
    for (const a of doc.querySelectorAll("a[href]")) add(a.getAttribute("href"), a.textContent);
    for (const img of doc.querySelectorAll("img[src]")) add(img.getAttribute("src"), img.getAttribute("alt"));

    return [...found.values()].slice(0, MAX_IMAGES_PER_URL);
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

    /* One hop past the index, to pick up solver pages linked only from hubs.
     * Deliberately not a full crawl. noindex pages (stubs, /stats, 404) are skipped.
     */
    const deeper = [];
    for (const link of new Set(links)) {
        const child = path.resolve("./dist", `${link}.html`);
        if (!fs.existsSync(child)) continue;
        const childHtml = fs.readFileSync(child, "utf8");
        const childDom = new JSDOM(childHtml);
        for (const a of childDom.window.document.querySelectorAll("a")) {
            const href = a.getAttribute("href");
            if (!href || href.startsWith("http") || href.startsWith("#")) continue;
            if (!href.startsWith("/")) continue;
            if (IMAGE_EXTENSIONS.test(href)) continue;
            const clean = href.replace(/\?.*$/, "").replace(/\.html$/, "").replace(/^\//, "");
            const target = path.resolve("./dist", `${clean}.html`);
            if (!fs.existsSync(target)) continue;
            if (/<meta name="robots" content="[^"]*noindex/.test(fs.readFileSync(target, "utf8"))) continue;
            deeper.push(clean);
        }
    }

    const uniqueLinks = [...new Set([...links, ...deeper])];

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
    let imagesWritten = 0;

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
            const img = imagesFor(link);
            imagesWritten += img.length;
            sitemap.write({ url: `/${link}`, ...(lastmod && { lastmod }), ...(img.length && { img }) });
            written++;
        }
    }

    sitemap.end();
    const data = await streamToPromise(sitemap);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, data.toString());

    console.log(`sitemap.xml generated with ${written + 1} pages (homepage + ${written} linked) and ${imagesWritten} images.`);
    if (missingCache > 0) {
        console.warn(`${missingCache} pages had no cache entry — lastmod omitted. Run update-page-dates.cjs.`);
    }
}

buildSitemap();
