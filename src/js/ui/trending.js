"use strict";
/**
 * Trending indicator
 * ------------------
 * On the home page (gated by <body data-trending>), marks the single most-viewed
 * guide and the single most-viewed solver over the last 7 days with a subtle 🔥.
 *
 * The ranking comes from GET /api/trending (D1 `view_days`, edge-cached). The
 * guide-vs-solver split and link matching are done here from the index's own
 * links: solver links carry `.solver-link`, and `.disabled` (unfinished) links
 * are skipped — so it works even where a path doesn't follow naming conventions
 * (e.g. /citadelle_void_table).
 */
document.addEventListener("DOMContentLoaded", () => {
    if (!document.body.hasAttribute("data-trending"))
        return;
    // Map normalized path -> { anchor, isSolver } from the index's internal links.
    const byPath = new Map();
    document.querySelectorAll("a[data-prefetchable]").forEach((a) => {
        if (a.classList.contains("disabled"))
            return;
        const href = a.getAttribute("href");
        if (!href)
            return;
        const p = normPath(href);
        if (!p.startsWith("/games/"))
            return;
        if (!byPath.has(p)) {
            byPath.set(p, { anchor: a, isSolver: a.classList.contains("solver-link") });
        }
    });
    if (byPath.size === 0)
        return;
    fetch("/api/trending")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data) => {
        const ranked = data.ranked || [];
        let guideDone = false;
        let solverDone = false;
        for (const item of ranked) {
            if (!item.path)
                continue;
            const hit = byPath.get(normPath(item.path));
            if (!hit)
                continue;
            if (hit.isSolver && !solverDone) {
                decorate(hit.anchor, "Most-viewed solver this week");
                solverDone = true;
            }
            else if (!hit.isSolver && !guideDone) {
                decorate(hit.anchor, "Most-viewed guide this week");
                guideDone = true;
            }
            if (guideDone && solverDone)
                break;
        }
    })
        .catch((err) => {
        // Endpoint unreachable (e.g. eleventy dev server) — no indicator, no noise.
        window.Log("warn", "[trending] unavailable:", err);
    });
    function decorate(anchor, label) {
        if (anchor.querySelector(".trending-flame"))
            return;
        anchor.classList.add("trending-link");
        const flame = document.createElement("span");
        flame.className = "trending-flame";
        flame.textContent = "🔥";
        flame.title = label;
        flame.setAttribute("role", "img");
        flame.setAttribute("aria-label", label);
        anchor.appendChild(flame);
    }
    /** Same-origin pathname, query/hash dropped, trailing slash and .html stripped. */
    function normPath(href) {
        let p;
        try {
            p = new URL(href, window.location.origin).pathname;
        }
        catch {
            return "";
        }
        if (p.length > 1)
            p = p.replace(/\/+$/, "");
        return p.replace(/\.html$/, "");
    }
});
