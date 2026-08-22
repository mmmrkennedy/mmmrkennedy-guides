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

// Google caps an <image:image> list at 1000 per URL. No page is near it (the
// biggest guide has ~105 screenshots), but slice anyway so a future one cannot
// silently invalidate the whole entry.
const MAX_IMAGES_PER_URL = 1000;
const SITEMAP_IMAGE_EXT = /\.(webp|png|jpg|jpeg|gif)$/i;

// Point Google at the downscaled copy rather than the master. Measured over a
// sample of eight live screenshots, masters averaged ~694KB against ~133KB at
// this tier, so across the 4,916 listed here the crawl is roughly 3.4GB of
// masters or 650MB of variants. The spread is wide (the largest master sampled
// was 3.0MB and came back 164KB, an 18x cut), which is the case this exists for.
// 1280px is ample for Google Images, and nothing on the page references these
// files as <img>, so there is no second URL for the same screenshot to disagree
// with.
//
// Safe on every entry regardless of whether the variant exists. The tier is
// allowlisted in functions/games/[[path]].js and an image with no variant in the
// bucket (the 151 already smaller than 1280, plus any map Part 2 has not reached)
// quietly falls back to the master, so the URL resolves either way.
const SITEMAP_IMAGE_TIER = "?w=1280";

/**
 * Every screenshot in a guide is a lightbox <a href="…webp">, never an <img>, so
 * none of them exist in the DOM Google crawls: a 4,850-word illustrated
 * walkthrough currently offers Google Images nothing. Listing them here is the
 * supported way to surface media a crawler cannot see in the markup, and unlike
 * adding real <img> tags it costs the page zero bytes and zero requests.
 *
 * Read from dist, not src: the page shipped is the one whose links must resolve.
 * The files themselves are usually absent from dist (IMAGES_FROM_R2 skips the
 * copy and functions/games/[[path]].js serves them from the bucket), so there is
 * nothing on disk to verify against — the URL is the deliverable, not the file.
 */
function imagesFor(link) {
    const built = path.resolve("./dist", `${link}.html`);
    if (!fs.existsSync(built)) return [];

    // Pages are served extensionless, so a relative href resolves against the
    // directory the page sits in: /games/AW/carrier/carrier_guide + pictures/x.webp
    // → /games/AW/carrier/pictures/x.webp. Let URL do that resolution rather than
    // joining strings, so ../ and query strings behave.
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
        // Same-origin guide media only. Site chrome (og_image, favicon,
        // tips_symbol) is not content and does not belong in an image sitemap.
        if (url.origin !== SITE_URL) return;
        if (!url.pathname.startsWith("/games/")) return;
        if (!SITEMAP_IMAGE_EXT.test(url.pathname)) return;

        // Keyed on the bare path, emitted with the tier: two hrefs to the same
        // screenshot still collapse to one entry whatever query each carried.
        const clean = SITE_URL + url.pathname;
        if (found.has(clean)) return;

        const text = (caption || "").replace(/\s+/g, " ").trim();
        found.set(clean, { url: clean + SITEMAP_IMAGE_TIER, ...(text && text.length <= 200 && { caption: text }) });
    };

    // The anchor's own text is the caption the author already wrote for the
    // screenshot ("Teleport Grenades from the wallbuy"), so it doubles as the
    // alt text these images have never had.
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

    /* One level deeper than the index.
     *
     * The index links one entry per map, and a map with several solvers points
     * at a hub page that links to one page per puzzle. Those puzzle pages are
     * real, indexable destinations, but they are not on the index and never
     * will be: putting all eleven of them in the homepage list is exactly the
     * clutter the hub exists to avoid. So the crawl goes one hop further and
     * picks up what the index-linked pages link to.
     *
     * Deliberately one hop, not a full crawl: the index plus its children is
     * the whole site, and an unbounded walk would start pulling in whatever a
     * guide happens to link. `noindex` is the stop sign — an unfinished guide
     * stub, /stats and 404 all carry it, so a page that does not want to be in
     * the index cannot arrive here by being linked from one that is.
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
        console.warn(`${missingCache} pages had no cache entry — lastmod omitted. Run refresh-lastmod-cache.cjs via GitHub Actions.`);
    }
}

buildSitemap();
