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
 * Like footer.ts and line-flagger.ts, a failed call is treated as "no data
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

/**
 * Sortable tables
 * ---------------
 * Turns the column headers of any `table[data-sortable]` into sort controls.
 *
 * Progressive enhancement: the markup ships as a plain table already sorted by
 * the build (words, descending), and this wraps each header label in a button on
 * load. Without JS the table is still correct, just fixed in that order.
 *
 * Each sortable `<th>` declares a `data-sort-type`:
 *   number  parsed from the cell text, so "1,234" sorts as 1234
 *   date    the ISO "YYYY-MM-DD" the cell already prints, compared as text
 *   text    case-insensitive, locale-aware
 *
 * First click on a column sorts the way that column is most useful: descending
 * for numbers and dates (biggest, newest), ascending for text (A to Z). Clicking
 * the same column again flips it.
 */
type SortDirection = "ascending" | "descending";
type SortKey = string | number | null;

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll<HTMLTableElement>("table[data-sortable]").forEach(enhance);

    function enhance(table: HTMLTableElement): void {
        const headRow = table.tHead?.rows[0];
        const body = table.tBodies[0];
        if (!headRow || !body) return;

        const rows = Array.from(body.rows);
        if (rows.length < 2) return; // nothing to reorder

        // The build's order is the tiebreak, so rows with equal values never
        // shuffle against each other from one sort to the next.
        rows.forEach((row, i) => (row.dataset.sortIndex = String(i)));

        const headers = Array.from(headRow.cells).filter((th) => th.dataset.sortType);

        headers.forEach((th) => {
            const label = (th.textContent ?? "").trim();
            const button = document.createElement("button");
            button.type = "button";
            button.className = "stats-table__sort";
            button.textContent = label;

            th.textContent = "";
            th.appendChild(button);
            // Leave a header the build already sorted by showing its direction.
            if (!th.getAttribute("aria-sort")) th.setAttribute("aria-sort", "none");

            button.addEventListener("click", () => {
                const current = th.getAttribute("aria-sort");
                const direction: SortDirection =
                    current === "descending"
                        ? "ascending"
                        : current === "ascending"
                          ? "descending"
                          : defaultDirection(th.dataset.sortType);

                for (const other of headers) other.setAttribute("aria-sort", "none");
                th.setAttribute("aria-sort", direction);
                sort(th, direction);
            });
        });

        function sort(th: HTMLTableCellElement, direction: SortDirection): void {
            const column = th.cellIndex;
            const type = th.dataset.sortType ?? "text";

            const ordered = rows.slice().sort((a, b) => {
                const result = compare(keyFor(a, column, type), keyFor(b, column, type), direction);
                return result !== 0
                    ? result
                    : Number(a.dataset.sortIndex) - Number(b.dataset.sortIndex);
            });

            // One reflow instead of one per row.
            const fragment = document.createDocumentFragment();
            for (const row of ordered) fragment.appendChild(row);
            body.appendChild(fragment);
        }
    }

    /** Numbers and dates open biggest-first; words open A to Z. */
    function defaultDirection(type: string | undefined): SortDirection {
        return type === "number" || type === "date" ? "descending" : "ascending";
    }

    function keyFor(row: HTMLTableRowElement, column: number, type: string): SortKey {
        const text = (row.cells[column]?.textContent ?? "").trim();
        if (!text) return null; // no value: sorts last either way

        if (type === "number") {
            // Cells print thousands separators, so keep only the number itself.
            const value = Number(text.replace(/[^0-9.-]/g, ""));
            return Number.isFinite(value) ? value : null;
        }
        // ISO dates compare correctly as plain strings, so they need no parsing.
        return type === "date" ? text : text.toLowerCase();
    }

    function compare(a: SortKey, b: SortKey, direction: SortDirection): number {
        // Blanks sink to the bottom in both directions: an unknown value is never
        // "the smallest", it's just missing.
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;

        const result =
            typeof a === "number" && typeof b === "number"
                ? a - b
                : String(a).localeCompare(String(b), "en");

        return direction === "ascending" ? result : -result;
    }
});
