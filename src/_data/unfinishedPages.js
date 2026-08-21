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
 * Same registry relatedMaps.js reads, and for the same reason: the class on the
 * index link is the one place the site records that a map has no guide behind it
 * yet, so anything that must not link to a placeholder can ask here instead of
 * keeping its own list.
 *
 * The hrefs are already root-relative, so the "/" this used to prepend produced
 * "//games/…" — a protocol-relative URL pointing at a host called "games", and
 * a string that could never equal any page path. Deduped because a remastered
 * map is listed under both its original game and the collection that reissued
 * it (Moon, Origins), and normalised the way cleanUrl normalises a page URL so
 * the two can be compared directly.
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
