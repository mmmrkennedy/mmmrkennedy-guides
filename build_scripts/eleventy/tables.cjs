/**
 * Gives every <table> its scroll wrapper and, where it can, labels each body cell
 * with its column heading so CSS can restack rows as cards on phones (see "Mobile:
 * one card per row" in components.css).
 */
function prepareTables(document) {
    const tables = document.querySelectorAll("table");
    if (!tables.length) return false;
    let modified = false;
    for (const table of tables) {
        let wrapper = table.parentElement;
        if (!wrapper?.classList.contains("table-scroll")) {
            wrapper = document.createElement("div");
            wrapper.className = "table-scroll";
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
            modified = true;
        }
        if (labelTableCells(table)) {
            wrapper.classList.add("table-scroll--cards");
            modified = true;
        }
    }
    return modified;
}

/**
 * Every cell with the row and column it actually occupies. With a rowspan above
 * it, a row's second <td> can be the third column, so cellIndex would be wrong.
 */
function mapTableGrid(table) {
    const taken = [];
    const cells = [];
    let row = 0;

    for (const rowEl of table.rows) {
        taken[row] ??= [];
        let col = 0;
        for (const cell of rowEl.cells) {
            while (taken[row][col]) col += 1;
            const rowSpan = cell.rowSpan || 1;
            const colSpan = cell.colSpan || 1;
            cells.push({ cell, rowEl, row, col, rowSpan, colSpan });
            for (let r = row; r < row + rowSpan; r += 1) {
                taken[r] ??= [];
                for (let c = col; c < col + colSpan; c += 1) taken[r][c] = true;
            }
            col += colSpan;
        }
        row += 1;
    }

    return cells;
}

/**
 * Marks up a table for card mode and returns whether it took it. Two shapes don't:
 * colspan (a spanning cell has no single heading) and [data-sortable] (ui/stats.ts
 * puts its controls in the header row, which card mode hides).
 *
 * A rowspan cell would appear on only one card, so each covered row gets a copy
 * marked `data-card-copy`, which CSS shows in card mode and hides otherwise.
 */
function labelTableCells(table) {
    if (table.hasAttribute("data-cards")) return true;
    if (table.hasAttribute("data-sortable")) return false;
    if (table.querySelector("[colspan]")) return false;
    if (fitsOnPhoneAsTable(table)) return false;

    const headRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headRow?.cells.length) return false;
    const headings = Array.from(headRow.cells);
    if (!headings.every((cell) => cell.tagName === "TH")) return false;

    // .table-key's first column becomes the card's title, so it gets no label.
    const titleColumn = table.classList.contains("table-key") ? 0 : -1;
    const labelFor = (col) => headings[col]?.textContent.replace(/\s+/g, " ").trim();

    const grid = mapTableGrid(table);
    const bodyCells = grid.filter((entry) => entry.rowEl !== headRow && entry.cell.tagName === "TD");

    for (const { cell, col } of bodyCells) {
        if (col === titleColumn) continue;
        const label = labelFor(col);
        if (label) cell.setAttribute("data-label", label);
    }

    const rows = Array.from(table.rows);
    for (const { cell, col, row, rowSpan } of bodyCells) {
        if (rowSpan < 2) continue;
        for (let r = row + 1; r < row + rowSpan && r < rows.length; r += 1) {
            const copy = cell.cloneNode(true);
            copy.removeAttribute("rowspan");
            copy.removeAttribute("id");
            copy.setAttribute("data-card-copy", "");
            if (col === titleColumn) copy.removeAttribute("data-label");

            const after = grid.find((e) => e.rowEl === rows[r] && e.col > col);
            rows[r].insertBefore(copy, after?.cell ?? null);
        }
    }

    headRow.setAttribute("data-card-head", "");
    table.setAttribute("data-cards", "");
    return true;
}

/**
 * Whether a table's values are short enough to read as columns on a phone, in
 * which case cards would only make it much taller. Sums each column's longest
 * value, in characters.
 */
function fitsOnPhoneAsTable(table) {
    if (table.querySelector("td :is(ul, ol, table, img, button, div)")) return false;

    const columns = [];
    for (const row of table.rows) {
        for (const [col, cell] of Array.from(row.cells).entries()) {
            if (cell.tagName !== "TD") continue;
            const length = cell.textContent.replace(/\s+/g, " ").trim().length;
            columns[col] = Math.max(columns[col] ?? 0, length);
        }
    }

    if (!columns.length || columns.length > 3) return false;
    return columns.reduce((sum, length) => sum + length, 0) <= 62;
}

module.exports = { prepareTables };
