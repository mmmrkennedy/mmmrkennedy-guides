import { homepageDoc } from "../../build_scripts/eleventy/homepage.cjs";

/**
 * Normalised like cleanUrl so it compares directly with a page URL. Deduped
 * because a remaster is listed under two games. Same list in every run mode;
 * dev's stub-body rendering is gated on `site.serve` in base.njk instead.
 */
export default function () {
    const links = homepageDoc().querySelectorAll("a.disabled");

    const paths = new Set();
    links.forEach((link) => {
        const href = link.getAttribute("href");
        if (href) {
            paths.add(href.split("?")[0].replace(/\.html$/, ""));
        }
    });

    return [...paths];
}
