// Chip labels for the home page's game jump-bar, keyed by the <h2 id> they scroll to.
const INDEX_NAV_LABELS = {
    BO7: "BO7", BO6: "BO6", VG: "Vanguard", BO_CW: "Cold War",
    BO4: "BO4", WW2: "WW2", IW: "IW", BO3: "BO3",
    AW: "AW", BO2: "BO2", BO1: "BO1", WAW: "WAW",
};

/**
 * The home page's jump chips and completion tally. Built here because they sit
 * above every map list, so adding them from a script would push the page down.
 */
function preRenderIndexNav(document) {
    const nav = document.querySelector("[data-index-nav]");
    if (!nav) return false;

    const chipsBox = nav.querySelector(".index-nav__chips");
    const container = document.querySelector(".content-container");
    if (!chipsBox || !container) return false;

    chipsBox.replaceChildren();
    for (const heading of container.querySelectorAll("h2[id]")) {
        // A game is an <h2 id> with a <ul> after it, as in index-filter.ts.
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
 * The completion tally, counted the same way as renderProgress() in index-filter.ts,
 * which recomputes it at runtime: every /games/ link that isn't a `.solver-link` is
 * one map, keyed by path, and complete unless every listing of it is `.disabled`.
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
