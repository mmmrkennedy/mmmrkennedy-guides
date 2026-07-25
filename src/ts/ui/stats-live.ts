/**
 * Live view stats
 * ---------------
 * On /stats (gated by <body data-stats-live>), fills the "Most read in the last
 * 7 days" chart from GET /api/trending — the same edge-cached D1 ranking the
 * home page's 🔥 marker uses, so this costs no new endpoint and no extra query.
 *
 * The ranking is paths only, so guide names come from the page itself: the
 * build-time table at the bottom of /stats already lists every published guide
 * with its URL, which also means a path the site no longer publishes is dropped
 * rather than rendered as a bare URL.
 *
 * Like view-counter.ts and line-flagger.ts, a failed call is treated as "no data
 * yet" rather than an error — the eleventy dev server has no Functions, and a
 * fresh deploy has no view history. The section removes itself in that case; the
 * rest of the page is build-time data and stands on its own.
 */
document.addEventListener("DOMContentLoaded", () => {
    if (!document.body.hasAttribute("data-stats-live")) return;

    const section = document.getElementById("live-views");
    const status = section?.querySelector<HTMLElement>(".stats-live__status");
    const chart = section?.querySelector<HTMLElement>(".stats-live__chart");
    if (!section || !status || !chart) return;

    const TOP_N = 10;

    // Published guides, keyed by normalized path, from the table this page already renders.
    const names = new Map<string, { name: string; url: string }>();
    document.querySelectorAll<HTMLAnchorElement>(".stats-table a[href]").forEach((a) => {
        const url = a.getAttribute("href");
        if (!url) return;
        names.set(normPath(url), { name: a.textContent?.trim() ?? url, url });
    });

    fetch("/api/trending")
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { ranked?: Array<{ path?: string; count?: number }> }) => {
            const rows: Array<{ name: string; url: string; count: number }> = [];
            for (const item of data.ranked || []) {
                if (!item.path || typeof item.count !== "number") continue;
                const hit = names.get(normPath(item.path));
                if (!hit) continue; // a solver, or a page no longer published
                rows.push({ name: hit.name, url: hit.url, count: item.count });
                if (rows.length === TOP_N) break;
            }
            if (rows.length === 0) {
                section.remove();
                return;
            }

            const max = rows[0].count;
            for (const row of rows) {
                const li = document.createElement("li");
                li.className = "chart__row";

                const label = document.createElement("a");
                label.className = "chart__label";
                label.href = row.url;
                label.textContent = row.name;

                const plot = document.createElement("span");
                plot.className = "chart__plot";
                const bar = document.createElement("span");
                bar.className = "chart__bar";
                bar.style.width = Math.max(1.5, (row.count / max) * 100).toFixed(2) + "%";
                plot.appendChild(bar);

                const value = document.createElement("span");
                value.className = "chart__value";
                value.textContent = row.count.toLocaleString("en-US");

                li.append(label, plot, value);
                chart.appendChild(li);
            }

            status.textContent = "Views over the last 7 days. Updates hourly.";
            chart.hidden = false;
        })
        .catch(() => {
            // No Functions locally, or no history yet — drop the section quietly.
            section.remove();
        });

    /** Mirror the server's path shape: leading slash, no trailing slash, no .html. */
    function normPath(p: string): string {
        let out = p.split(/[?#]/)[0];
        if (!out.startsWith("/")) out = "/" + out;
        out = out.replace(/\.html$/, "");
        if (out.length > 1) out = out.replace(/\/+$/, "");
        return out;
    }
});
