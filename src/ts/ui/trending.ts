import { log } from "../core/logger";

/**
 * Guide vs solver comes from the index's links (.solver-link), not the path, since
 * some paths don't follow naming conventions (e.g. /citadelle_void_table).
 */
document.addEventListener("DOMContentLoaded", () => {
    if (!document.body.hasAttribute("data-trending")) return;

    const byPath = new Map<string, { anchor: HTMLAnchorElement; isSolver: boolean }>();
    document.querySelectorAll<HTMLAnchorElement>('a[href^="/games/"]').forEach((a) => {
        if (a.classList.contains("disabled")) return;
        const href = a.getAttribute("href");
        if (!href) return;
        const p = normPath(href);
        if (!p.startsWith("/games/")) return;
        if (!byPath.has(p)) {
            byPath.set(p, { anchor: a, isSolver: a.classList.contains("solver-link") });
        }
    });
    if (byPath.size === 0) return;

    fetch("/api/trending")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { ranked?: Array<{ path?: string }> }) => {
            const ranked = data.ranked || [];
            let guideDone = false;
            let solverDone = false;
            for (const item of ranked) {
                if (!item.path) continue;
                const hit = byPath.get(normPath(item.path));
                if (!hit) continue;
                if (hit.isSolver && !solverDone) {
                    decorate(hit.anchor, "Most-viewed solver this week");
                    solverDone = true;
                } else if (!hit.isSolver && !guideDone) {
                    decorate(hit.anchor, "Most-viewed guide this week");
                    guideDone = true;
                }
                if (guideDone && solverDone) break;
            }
        })
        .catch((err) => {
            // Expected on the eleventy dev server, which has no /api.
            log("warn", "[trending] unavailable:", err);
        });

    function decorate(anchor: HTMLAnchorElement, label: string): void {
        if (anchor.querySelector(".trending-flame")) return;
        anchor.classList.add("trending-link");
        const flame = document.createElement("span");
        flame.className = "trending-flame";
        flame.textContent = "🔥";
        flame.title = label;
        flame.setAttribute("role", "img");
        flame.setAttribute("aria-label", label);
        anchor.appendChild(flame);
    }

    function normPath(href: string): string {
        let p: string;
        try {
            p = new URL(href, window.location.origin).pathname;
        } catch {
            return "";
        }
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p.replace(/\.html$/, "");
    }
});
