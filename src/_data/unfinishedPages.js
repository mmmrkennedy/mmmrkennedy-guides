import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Normalised like cleanUrl so it compares directly with a page URL. Deduped
 * because a remaster is listed under two games. Same list in every run mode;
 * dev's stub-body rendering is gated on `site.serve` in base.njk instead.
 */
export default function () {
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
