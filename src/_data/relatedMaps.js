import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Sibling-map links, derived from src/index.html so the two can never disagree.
 *
 * Guide pages had exactly one crawlable internal link between them (/stats in
 * the footer): the Home control is a <button onclick>, which Google does not
 * follow, and nothing linked a map to the other maps in its game. The site was
 * a homepage pointing at 63 dead ends, so no page passed authority to any other
 * and nothing connected "Mob of the Dead" to the rest of Black Ops 2.
 *
 * Returns a lookup keyed by extensionless page URL:
 *
 *   "/games/BO2/mob_of_the_dead/mob_of_the_dead_guide": {
 *       groups: [
 *           { gameId: "BO2", gameName: "Black Ops 2", maps: [{ url, title }] },
 *           { gameId: "BO1", gameName: "Black Ops",   maps: [{ url, title }, ...] }
 *       ]
 *   }
 *
 * Always grouped under a real game name. Every link sits beside the title of
 * the game it belongs to, which is the context a reader needs to decide whether
 * to follow it, and the context a crawler reads from the surrounding text.
 *
 * Grouping is by the URL's own game segment, NOT by the <h2> the link sits
 * under. Those differ on purpose: the Black Ops 3 section lists the Zombies
 * Chronicles remasters, which point at the original game's guide
 * (/games/WAW/der_riese/der_riese_guide?version=remake as "The Giant"). Der
 * Riese belongs with the World at War maps whichever section links it, and the
 * path is the only thing that says so.
 */
export default function () {
    const html = readFileSync(join(__dirname, "../index.html"), "utf8");
    const doc = new JSDOM(html).window.document;

    /** "/games/BO2/origins/origins_guide?version=x" -> "/games/BO2/origins/origins_guide" */
    const clean = (href) => href.split("?")[0].replace(/\.html$/, "");

    /** "/games/BO2/origins/origins_guide" -> "BO2" */
    const gameOf = (url) => url.split("/")[2] || null;

    const gameNames = {};
    const gameOrder = []; // index order, newest game first
    for (const h of doc.querySelectorAll("h2[id]")) {
        gameNames[h.id] = h.textContent.trim();
        gameOrder.push(h.id);
    }

    // Document order, so a link is always attributed to the heading above it.
    const nodes = doc.querySelectorAll('h2[id], a[href^="/games/"]');

    const guides = new Map(); // url -> { url, title, gameId }
    const entries = new Map(); // url -> gameId, for every linkable page incl. solvers
    let section = null;

    for (const node of nodes) {
        if (node.tagName === "H2") {
            section = node.id;
            continue;
        }

        // Unfinished maps are noindex stubs. Linking them would spend crawl
        // budget on pages that say "check back later", so they are listed
        // nowhere until their guide is written and the class comes off.
        if (node.classList.contains("disabled")) continue;

        const url = clean(node.getAttribute("href"));
        const gameId = gameOf(url);
        if (!gameId) continue;

        entries.set(url, gameId);
        if (node.classList.contains("solver-link")) continue;

        // A remaster is listed twice under two names. The canonical one is the
        // label used in the section that owns the path, so let that overwrite a
        // name picked up from a borrowing section, and never the reverse.
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

    // Same-game links alone leave the newer games stranded: four of Black Ops
    // 2's six maps are unwritten, so Mob of the Dead would offer exactly one
    // onward link, and Black Ops 6 and 7 are thinner still. Top up from the
    // nearest games in index order (which runs newest to oldest, so a game's
    // neighbours are the releases either side of it) until the page carries a
    // useful number of onward links. Well-stocked games like WW2 and BO4 never
    // reach for this.
    const MIN_LINKS = 6;

    const group = (gameId, maps) => ({ gameId, gameName: gameNames[gameId] || gameId, maps });

    const lookup = {};
    for (const [url, gameId] of entries) {
        const siblings = (byGame.get(gameId) || []).filter((m) => m.url !== url);
        const groups = siblings.length ? [group(gameId, siblings)] : [];
        let count = siblings.length;

        // Walk outward from the page's own game until the block carries enough
        // onward links, adding each neighbouring game as its own named group.
        // A partly-filled game is truncated rather than split, so a group never
        // shows a game's maps in two places.
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
