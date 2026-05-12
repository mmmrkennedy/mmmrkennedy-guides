#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { SitemapStream, streamToPromise } = require("sitemap");
const { execSync } = require("child_process");

const SITE_URL = "https://mmmrkennedy.com"; // Change to your site
const INDEX_FILE = path.resolve("./dist/index.html"); // Path to your index.html
const OUTPUT_FILE = path.resolve("./dist/sitemap.xml");

function getAllGitLastModified() {
    try {
        const output = execSync(
            "git log --format=%cI --name-only --diff-filter=ACMRT",
            { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }
        ).trim();

        const map = {};
        let currentDate = null;
        for (const line of output.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
                currentDate = trimmed;
            } else if (currentDate) {
                const normalized = trimmed.replace(/\\/g, "/");
                if (!(normalized in map)) map[normalized] = currentDate;
            }
        }
        return map;
    } catch {
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
        .filter((href) => !IMAGE_EXTENSIONS.test(href)) // skip image links
        .map((href) => href.replace(/^\/?/, ""))
        .map((href) => href.replace(/\?.*$/, ""))
        .map((href) => href.replace(/\.html$/, ""));

    const uniqueLinks = [...new Set(links)];

    if (uniqueLinks.length === 0) {
        console.error("No valid links found in index.html");
        process.exit(1);
    }

    const repoRoot = path.resolve(".");
    const gitDates = getAllGitLastModified();

    const sitemap = new SitemapStream({ hostname: SITE_URL });

    // include the homepage first
    sitemap.write({ url: "/", lastmod: fs.statSync(INDEX_FILE).mtime });

    // then add all linked pages
    let written = 0;
    for (const link of uniqueLinks) {
        const candidates = [
            path.resolve("./src", `${link}.html`),
            path.resolve("./src", link, "index.html"),
            path.resolve("./src", link),
        ];
        const filePath = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
        if (filePath) {
            const relPath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
            const lastmod = gitDates[relPath] || fs.statSync(filePath).mtime;
            sitemap.write({ url: `/${link}`, lastmod });
            written++;
        }
    }

    sitemap.end();
    const data = await streamToPromise(sitemap);
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, data.toString());

    console.log(`sitemap.xml generated with ${written + 1} pages (homepage + ${written} linked)`);
}

buildSitemap();
