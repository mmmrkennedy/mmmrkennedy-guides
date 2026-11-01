import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Guides the index says are not written yet — every `a.disabled` in
 * src/index.html, as extensionless site paths:
 *
 *   ["/games/BO7/totenreich/totenreich_guide", ...]
 *
 * The class on the index link is the one place the site records that a map has no
 * guide yet. Deduped because a remaster is listed under two games, and normalised
 * like cleanUrl so it compares directly with a page URL.
 *
 * Empty under `eleventy --serve`, so a stub guide renders its real body while it's
 * being written. Builds get the full list.
 */
export default function () {
    if (process.env.ELEVENTY_RUN_MODE === "serve") {
        return [];
    }

    const indexPath = join(__dirname, "../index.html");
    const html = readFileSync(indexPath, "utf8");
    const dom = new JSDOM(html);
    const links = dom.window.document.querySelectorAll("a.disabled");

    const paths = new Set();
    links.forEach((link) => {
        const href = link.getAttribute("href");
        if (href) {
            paths.add(href.split("?")[0].replace(/\.html$/, ""));
        }
    });

    return [...paths];
}
