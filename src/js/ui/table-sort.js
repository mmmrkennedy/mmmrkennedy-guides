"use strict";
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("table[data-sortable]").forEach(enhance);
    function enhance(table) {
        const headRow = table.tHead?.rows[0];
        const body = table.tBodies[0];
        if (!headRow || !body)
            return;
        const rows = Array.from(body.rows);
        if (rows.length < 2)
            return; // nothing to reorder
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
            if (!th.getAttribute("aria-sort"))
                th.setAttribute("aria-sort", "none");
            button.addEventListener("click", () => {
                const current = th.getAttribute("aria-sort");
                const direction = current === "descending"
                    ? "ascending"
                    : current === "ascending"
                        ? "descending"
                        : defaultDirection(th.dataset.sortType);
                for (const other of headers)
                    other.setAttribute("aria-sort", "none");
                th.setAttribute("aria-sort", direction);
                sort(th, direction);
            });
        });
        function sort(th, direction) {
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
            for (const row of ordered)
                fragment.appendChild(row);
            body.appendChild(fragment);
        }
    }
    /** Numbers and dates open biggest-first; words open A to Z. */
    function defaultDirection(type) {
        return type === "number" || type === "date" ? "descending" : "ascending";
    }
    function keyFor(row, column, type) {
        const text = (row.cells[column]?.textContent ?? "").trim();
        if (!text)
            return null; // no value: sorts last either way
        if (type === "number") {
            // Cells print thousands separators, so keep only the number itself.
            const value = Number(text.replace(/[^0-9.-]/g, ""));
            return Number.isFinite(value) ? value : null;
        }
        // ISO dates compare correctly as plain strings, so they need no parsing.
        return type === "date" ? text : text.toLowerCase();
    }
    function compare(a, b, direction) {
        // Blanks sink to the bottom in both directions: an unknown value is never
        // "the smallest", it's just missing.
        if (a === null && b === null)
            return 0;
        if (a === null)
            return 1;
        if (b === null)
            return -1;
        const result = typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b), "en");
        return direction === "ascending" ? result : -result;
    }
});
