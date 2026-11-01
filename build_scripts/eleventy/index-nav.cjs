// Chip labels for the home page's game jump-bar, keyed by the <h2 id> they
// scroll to. The build owns them because the build is what renders the bar;
// index-filter.ts reads the labels back off the chips it finds.
const INDEX_NAV_LABELS = {
    BO7: "BO7", BO6: "BO6", VG: "Vanguard", BO_CW: "Cold War",
    BO4: "BO4", WW2: "WW2", IW: "IW", BO3: "BO3",
    AW: "AW", BO2: "BO2", BO1: "BO1", WAW: "WAW",
};

/**
 * Pre-render the home page's jump chips and completion tally.
 *
 * index-filter.ts used to build both at DOMContentLoaded into an empty row. The
 * row is above every map list, so when the script ran the bar grew by the
 * height of the chips — 92px on a phone, where they wrap to two lines and the
 * tally takes a third — and pushed the whole page down after paint. That was
 * the homepage's 0.110 CLS, reported against the first <ul> that moved.
 *
 * Same treatment as the sidebar TOC in renderSidebarToc: ship the markup, let
 * the script hydrate it. Both are derived from the page's own headings and
 * links, so the build can compute exactly what the script would have.
 */
function preRenderIndexNav(document) {
    const nav = document.querySelector("[data-index-nav]");
    if (!nav) return false;

    const chipsBox = nav.querySelector(".index-nav__chips");
    const container = document.querySelector(".content-container");
    if (!chipsBox || !container) return false;

    chipsBox.replaceChildren();
    for (const heading of container.querySelectorAll("h2[id]")) {
        // Same pairing rule as index-filter.ts: a game is an <h2 id> with a
        // <ul> after it. A heading with no list gets no chip.
        let list = heading.nextElementSibling;
        while (list && list.tagName !== "UL") list = list.nextElementSibling;
        if (!list) continue;

        const chip = document.createElement("a");
        chip.className = "index-nav__chip";
        chip.href = "#" + heading.id;
        chip.textContent = INDEX_NAV_LABELS[heading.id] || heading.id;
        chip.dataset.target = heading.id;
        chipsBox.appendChild(chip);
    }
    if (!chipsBox.children.length) return false;

    renderIndexProgress(document, container);
    return true;
}

/**
 * The completion tally, counted the way renderProgress() in index-filter.ts
 * counts it: every /games/ link that is not a `.solver-link` is one map, keyed
 * by path so a map listed under two games counts once, and complete unless
 * every listing of it is `.disabled`.
 *
 * The script still recomputes this at runtime and overwrites the text. That is
 * deliberate — it keeps one authority for the number — and it cannot shift the
 * page: the tally is a nowrap span on its own line, so a different width
 * changes nothing about the height.
 */
function renderIndexProgress(document, container) {
    const box = document.querySelector("[data-index-progress]");
    if (!box) return;

    const maps = new Map();
    for (const a of container.querySelectorAll("a[href], a[data-href]")) {
        if (a.classList.contains("solver-link")) continue;
        const target = a.getAttribute("href") || a.getAttribute("data-href") || "";
        const mapPath = target.split(/[?#]/)[0].replace(/\/+$/, "");
        if (!mapPath.startsWith("/games/")) continue;
        const complete = !a.classList.contains("disabled");
        maps.set(mapPath, (maps.get(mapPath) ?? false) || complete);
    }

    const total = maps.size;
    if (total === 0) return;

    let done = 0;
    for (const complete of maps.values()) if (complete) done++;

    let pct = Math.round((done / total) * 100);
    if (pct === 100 && done < total) pct = 99;
    if (pct === 0 && done > 0) pct = 1;

    box.textContent = `${done} / ${total} Guides Complete · ${pct}%`;
    const left = total - done;
    box.title = left === 0 ? "Every map is covered" : `${left} still being written`;
    box.removeAttribute("hidden");
}

module.exports = { preRenderIndexNav };
