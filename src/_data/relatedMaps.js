import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Sibling-map links, derived from src/index.html so the two can never disagree.
 *
 * Grouped by the URL's game segment, not the <h2> the link sits under: the
 * Black Ops 3 section lists Zombies Chronicles remasters that point at the
 * original game's guide.
 */
export default function () {
    const html = readFileSync(join(__dirname, "../index.html"), "utf8");
    const doc = new JSDOM(html).window.document;

    const clean = (href) => href.split("?")[0].replace(/\.html$/, "");

    const gameOf = (url) => url.split("/")[2] || null;

    const gameNames = {};
    const gameOrder = []; // index order, newest game first
    for (const h of doc.querySelectorAll("h2[id]")) {
        gameNames[h.id] = h.textContent.trim();
        gameOrder.push(h.id);
    }

    const nodes = doc.querySelectorAll('h2[id], a[href^="/games/"]');

    const guides = new Map();
    const entries = new Map(); // url -> gameId, every linkable page incl. solvers
    let section = null;

    for (const node of nodes) {
        if (node.tagName === "H2") {
            section = node.id;
            continue;
        }

        // Unfinished maps are noindex stubs; linking them wastes crawl budget.
        if (node.classList.contains("disabled")) continue;

        const url = clean(node.getAttribute("href"));
        const gameId = gameOf(url);
        if (!gameId) continue;

        entries.set(url, gameId);
        if (node.classList.contains("solver-link")) continue;

        // A remaster is listed twice under two names; the owning section's label wins.
        const canonical = section === gameId;
        if (!guides.has(url) || canonical) {
            guides.set(url, { url, title: node.textContent.trim(), gameId, canonical });
        }
    }

    const byGame = new Map();
    for (const g of guides.values()) {
        if (!byGame.has(g.gameId)) byGame.set(g.gameId, []);
        byGame.get(g.gameId).push({ url: g.url, title: g.title });
    }

    // Games with few written maps top up from neighbouring releases in index order.
    const MIN_LINKS = 6;

    const group = (gameId, maps) => ({ gameId, gameName: gameNames[gameId] || gameId, maps });

    const lookup = {};
    for (const [url, gameId] of entries) {
        const siblings = (byGame.get(gameId) || []).filter((m) => m.url !== url);
        const groups = siblings.length ? [group(gameId, siblings)] : [];
        let count = siblings.length;

        const home = gameOrder.indexOf(gameId);
        for (let step = 1; home !== -1 && count < MIN_LINKS && step < gameOrder.length; step++) {
            for (const neighbour of [gameOrder[home + step], gameOrder[home - step]]) {
                if (!neighbour || count >= MIN_LINKS) continue;
                const maps = (byGame.get(neighbour) || []).slice(0, MIN_LINKS - count);
                if (!maps.length) continue;
                groups.push(group(neighbour, maps));
                count += maps.length;
            }
        }

        if (!groups.length) continue;
        lookup[url] = { groups };
    }

    return lookup;
}
