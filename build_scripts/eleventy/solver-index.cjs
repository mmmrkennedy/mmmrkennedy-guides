/**
 * Solver listings, built from the solver pages' own front matter.
 *
 * Two places list solver pages: the site-wide /solvers page and each map's hub
 * (beast_solvers and friends). Both used to be written by hand, copying every
 * page's name and description, so adding a solver meant editing three files and
 * a description edit had to be made twice. Now a solver page is listed by
 * existing.
 *
 * A page is a solver page if it has `solverTitle`. The rest comes from fields
 * those pages already carry, plus two optional ones:
 *
 *   solverTitle   card name. "Solvers" marks a map's hub page.
 *   mapName       the map heading on /solvers.
 *   description   the line under the card on /solvers.
 *   hubLine       optional: the shorter line used on the map's hub. Falls back
 *                 to `description`.
 *   solverOrder   optional: position among the map's solvers (quest order).
 *                 Lower first; unset pages go last, by name.
 *
 * Games and maps run in homepage order, read from src/index.html the same way
 * relatedMaps.js does, so a new map slots in where the homepage puts it. A
 * solver page in a folder the homepage doesn't link at all goes at the end of
 * its game rather than being dropped.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const INDEX = path.join(__dirname, "..", "..", "src", "index.html");

/** "/games/BO6/reckoning/reckoning_solvers.html" -> "/games/BO6/reckoning/reckoning_solvers" */
const clean = (url) => url.split("?")[0].replace(/\.html$/, "");

/** "/games/BO6/reckoning/reckoning_solvers" -> "/games/BO6/reckoning" */
const folderOf = (url) => clean(url).split("/").slice(0, -1).join("/");

/** "/games/BO6/reckoning/..." -> "BO6" */
const gameOf = (url) => clean(url).split("/")[2];

const isHub = (item) => item.data.solverTitle === "Solvers";

function homepageOrder() {
    const doc = new JSDOM(fs.readFileSync(INDEX, "utf8")).window.document;
    const games = [];
    const gameNames = {};
    for (const h of doc.querySelectorAll("h2[id]")) {
        games.push(h.id);
        gameNames[h.id] = h.textContent.trim();
    }
    // First appearance of each map folder in its own game's section. Only that
    // section counts: Black Ops 3 also lists the Chronicles remasters (Moon,
    // Shangri-La...), and taking order from there would sort BO1's maps by
    // where BO3 borrows them. Disabled links count: a solver can be live before
    // its guide is.
    const folders = [];
    let section = null;
    for (const node of doc.querySelectorAll('h2[id], a[href^="/games/"]')) {
        if (node.tagName === "H2") {
            section = node.id;
            continue;
        }
        const href = node.getAttribute("href");
        if (gameOf(href) !== section) continue;
        const folder = folderOf(href);
        if (!folders.includes(folder)) folders.push(folder);
    }
    return { games, gameNames, folders };
}

/** Position in `list`, with anything missing after everything present. */
const rank = (list, value) => {
    const i = list.indexOf(value);
    return i === -1 ? Infinity : i;
};

const bySolverOrder = (a, b) =>
    (a.data.solverOrder ?? Infinity) - (b.data.solverOrder ?? Infinity) ||
    a.data.solverTitle.localeCompare(b.data.solverTitle);

/** Every solver page, hubs included, in listing order within each map. */
function solverPages(collectionApi) {
    return collectionApi
        .getAll()
        .filter((item) => item.data.solverTitle)
        .sort(bySolverOrder);
}

/**
 * The /solvers page, grouped:
 *   [{ id: "BO6", name: "Black Ops 6", maps: [{ name, cards: [{ url, name, line }] }] }]
 * Each map lists its hub first, then its solvers.
 */
function solverIndex(collectionApi) {
    const { games, gameNames, folders } = homepageOrder();
    const byFolder = new Map();
    for (const item of solverPages(collectionApi)) {
        const folder = folderOf(item.url);
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder).push(item);
    }

    const card = (item) => ({
        url: clean(item.url),
        name: isHub(item) ? `${item.data.mapName} Solvers` : item.data.solverTitle,
        line: item.data.description,
    });

    const byGame = new Map();
    const sortedFolders = [...byFolder.keys()].sort(
        (a, b) => rank(folders, a) - rank(folders, b) || a.localeCompare(b),
    );
    for (const folder of sortedFolders) {
        const items = byFolder.get(folder);
        const hubs = items.filter(isHub);
        const spokes = items.filter((item) => !isHub(item));
        const gameId = gameOf(folder + "/x");
        if (!byGame.has(gameId)) byGame.set(gameId, []);
        byGame.get(gameId).push({
            name: items[0].data.mapName,
            cards: [...hubs, ...spokes].map(card),
        });
    }

    return [...byGame.keys()]
        .sort((a, b) => rank(games, a) - rank(games, b) || a.localeCompare(b))
        .map((id) => ({ id, name: gameNames[id] || id, maps: byGame.get(id) }));
}

/** A hub's own solvers: the other solver pages in its folder, hubs excluded. */
function solverSpokes(pages, url) {
    const folder = folderOf(url);
    return (pages || []).filter((item) => !isHub(item) && folderOf(item.url) === folder);
}

module.exports = { solverPages, solverIndex, solverSpokes };
