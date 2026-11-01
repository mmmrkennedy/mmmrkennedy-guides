/**
 * Gives every <table> its horizontal-scroll wrapper, and — where the table can
 * take it — stamps each body cell with the heading of its column so the mobile
 * stylesheet can restack the row as a card (see "Mobile: one card per row" in
 * components.css).
 *
 * The labels are baked in here rather than read off the header row at runtime
 * because `td::before` can only print a string the CSS already holds, and the
 * only other source of one is a script that walks every table on every page
 * load to write the same attributes this loop writes once.
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
 * Walks a table into a grid, so every cell is known by the row and column it
 * actually occupies rather than by its position in the markup. With a rowspan
 * above it, a row's second `<td>` can be the third column, and labelling it off
 * `cellIndex` would give it the wrong heading.
 *
 * Returns one entry per cell: the element, its top-left grid position, and its
 * span.
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
 * Marks up one table for card mode: `data-label` on every body cell, an opt-in
 * `data-cards` on the table, and a marker on the header row so the stylesheet
 * can drop it once its text lives on the cells. Returns whether the table took
 * it — two shapes still don't:
 *
 *   - anything carrying colspan. One cell spanning several columns has no
 *     single heading to be labelled with, and splitting it would invent a
 *     division the author didn't write. These keep the scrolling table.
 *   - [data-sortable]. ui/stats.ts puts its controls in the header row, and
 *     card mode hides that row.
 *
 * rowspan is handled rather than refused. A spanned cell sits in the markup of
 * the first row it covers, so stacked into cards the rows underneath would
 * silently lose it — the strategy note shared by three challenges would appear
 * on one card and vanish from the other two. So each covered row gets its own
 * copy, marked `data-card-copy`, which the stylesheet shows in card mode and
 * hides everywhere else. The table on desktop is untouched: a display:none cell
 * occupies no column, so the original span still draws exactly as authored.
 */
function labelTableCells(table) {
    if (table.hasAttribute("data-cards")) return true;
    if (table.hasAttribute("data-sortable")) return false;
    if (table.querySelector("[colspan]")) return false;
    if (fitsOnPhoneAsTable(table)) return false;

    // Guides write the headings either in a <thead> or as a first row of <th>
    // inside the <tbody>; both are the same row for this purpose.
    const headRow = table.tHead?.rows[0] ?? table.rows[0];
    if (!headRow?.cells.length) return false;
    const headings = Array.from(headRow.cells);
    if (!headings.every((cell) => cell.tagName === "TH")) return false;

    // .table-key's first column is the row's subject, and card mode promotes it
    // to the card's title — a "Item" label sitting above it would only restate
    // the column it already is.
    const titleColumn = table.classList.contains("table-key") ? 0 : -1;
    const labelFor = (col) => headings[col]?.textContent.replace(/\s+/g, " ").trim();

    const grid = mapTableGrid(table);
    const bodyCells = grid.filter((entry) => entry.rowEl !== headRow && entry.cell.tagName === "TD");

    for (const { cell, col } of bodyCells) {
        if (col === titleColumn) continue;
        const label = labelFor(col);
        if (label) cell.setAttribute("data-label", label);
    }

    // Copies are inserted after the labelling pass, so they never shift the grid
    // the labels were read off.
    const rows = Array.from(table.rows);
    for (const { cell, col, row, rowSpan } of bodyCells) {
        if (rowSpan < 2) continue;
        for (let r = row + 1; r < row + rowSpan && r < rows.length; r += 1) {
            const copy = cell.cloneNode(true);
            copy.removeAttribute("rowspan");
            copy.removeAttribute("id");
            copy.setAttribute("data-card-copy", "");
            if (col === titleColumn) copy.removeAttribute("data-label");

            // Put it where the column says it belongs, so the card stacks its
            // cells in the order the table reads them.
            const after = grid.find((e) => e.rowEl === rows[r] && e.col > col);
            rows[r].insertBefore(copy, after?.cell ?? null);
        }
    }

    headRow.setAttribute("data-card-head", "");
    table.setAttribute("data-cards", "");
    return true;
}

/**
 * Whether a table's values are short enough to read as columns on a phone. Cards
 * give every value its own labelled row, which only earns its height when the
 * values are long: a two-column list of short names otherwise runs thousands of
 * pixels. Measured in characters, summing each column's longest value.
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
