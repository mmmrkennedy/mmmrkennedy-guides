// /api/trending returns paths only; names come from the build-time table on the page.
document.addEventListener("DOMContentLoaded", () => {
    if (!document.body.hasAttribute("data-stats-live")) return;

    const section = document.getElementById("live-views");
    const status = section?.querySelector<HTMLElement>(".stats-live__status");
    const chart = section?.querySelector<HTMLElement>(".stats-live__chart");
    if (!section || !status || !chart) return;

    const TOP_N = 10;

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
                if (!hit) continue; // a solver, or no longer published
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
            // No Functions on the dev server, or no history yet.
            section.remove();
        });

    // Must match the server's path shape.
    function normPath(p: string): string {
        let out = p.split(/[?#]/)[0];
        if (!out.startsWith("/")) out = "/" + out;
        out = out.replace(/\.html$/, "");
        if (out.length > 1) out = out.replace(/\/+$/, "");
        return out;
    }
});

// Sortable `table[data-sortable]`: each sortable <th> sets data-sort-type number | date | text.
type SortDirection = "ascending" | "descending";
type SortKey = string | number | null;

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll<HTMLTableElement>("table[data-sortable]").forEach(enhance);

    function enhance(table: HTMLTableElement): void {
        const headRow = table.tHead?.rows[0];
        const body = table.tBodies[0];
        if (!headRow || !body) return;

        const rows = Array.from(body.rows);
        if (rows.length < 2) return;

        // Build order is the tiebreak, so equal rows never shuffle between sorts.
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

            const fragment = document.createDocumentFragment();
            for (const row of ordered) fragment.appendChild(row);
            body.appendChild(fragment);
        }
    }

    function defaultDirection(type: string | undefined): SortDirection {
        return type === "number" || type === "date" ? "descending" : "ascending";
    }

    function keyFor(row: HTMLTableRowElement, column: number, type: string): SortKey {
        const text = (row.cells[column]?.textContent ?? "").trim();
        if (!text) return null;

        if (type === "number") {
            const value = Number(text.replace(/[^0-9.-]/g, ""));
            return Number.isFinite(value) ? value : null;
        }
        // ISO dates compare correctly as strings.
        return type === "date" ? text : text.toLowerCase();
    }

    function compare(a: SortKey, b: SortKey, direction: SortDirection): number {
        // Blanks sink to the bottom in both directions.
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
