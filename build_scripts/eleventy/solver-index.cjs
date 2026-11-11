/**
 * Solver listings for /solvers and each map's hub, from solver page front matter:
 *
 *   solverTitle   required; card name. "Solvers" marks a map's hub page.
 *   mapName       the map heading on /solvers.
 *   description   the line under the card on /solvers.
 *   hubLine       optional: shorter line on the map's hub, falls back to `description`.
 *   solverOrder   optional: quest order among the map's solvers.
 *
 * Games and maps follow homepage order (src/index.html), like relatedMaps.js.
 */

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const INDEX = path.join(__dirname, "..", "..", "src", "index.html");

const clean = (url) => url.split("?")[0].replace(/\.html$/, "");

const folderOf = (url) => clean(url).split("/").slice(0, -1).join("/");

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
    // Only a game's own section counts: BO3 also lists the Chronicles remasters
    // of other games' maps. Disabled links count: a solver can go live before its guide.
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

const rank = (list, value) => {
    const i = list.indexOf(value);
    return i === -1 ? Infinity : i;
};

const bySolverOrder = (a, b) =>
    (a.data.solverOrder ?? Infinity) - (b.data.solverOrder ?? Infinity) ||
    a.data.solverTitle.localeCompare(b.data.solverTitle);

function solverPages(collectionApi) {
    return collectionApi
        .getAll()
        .filter((item) => item.data.solverTitle)
        .sort(bySolverOrder);
}

/** [{ id: "BO6", name: "Black Ops 6", maps: [{ name, cards: [{ url, name, line }] }] }] */
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

function solverSpokes(pages, url) {
    const folder = folderOf(url);
    return (pages || []).filter((item) => !isHub(item) && folderOf(item.url) === folder);
}

module.exports = { solverPages, solverIndex, solverSpokes };
