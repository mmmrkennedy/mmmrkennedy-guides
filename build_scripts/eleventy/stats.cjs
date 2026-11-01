const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { lastmodCache, editcountCache, releaseCache } = require("./dates.cjs");

// Below this a page is a solver shell or a stub, not something with a readable
// length worth quoting, so it gets no footer count and no share of the total.
const WORDCOUNT_FLOOR = 100;

/**
 * Words of visible prose in a chunk of page HTML. Comments, <script>/<style>/
 * <template> bodies, reveal and path tab labels, and every tag (with its
 * attributes, so class names, hrefs and alt text never count) are dropped before
 * tokenizing. A word starts with
 * a letter or digit; inner apostrophes and hyphens keep "Pack-a-Punch" and
 * "Hell's" as one word each.
 */
function countWords(html) {
    if (!html) return 0;
    const text = String(html)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(button|summary)\b[^>]*(path-tabs__tab|btn--reveal)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&[a-z#0-9]+;/gi, "");
    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    return words ? words.length : 0;
}

const PICTURE_REF = /(?:href|src)\s*=\s*["']([^"']+?\.(?:webp|png|jpe?g|gif))["']/gi;

/**
 * Distinct screenshots a guide shows, counted from the links and <img>s in its
 * own HTML.
 *
 * This used to count image *files* in the guide's folder, which stopped working
 * when the images moved to R2: they're git-ignored now (see .gitignore), so a
 * Cloudflare checkout has none of them on disk and every guide measured zero.
 * Reading the references instead measures the same thing from something that
 * ships with the guide, and fixes two counting bugs the file walk had: it no
 * longer counts screenshots that no guide links any more, and a guide with
 * sub-guides under it (the Tortured Path survival maps) no longer counts its
 * children's folders as its own — that walk was recursive, so the three maps
 * and their parent were each claiming all four sets.
 *
 * Repeats collapse: linking one screenshot from two steps is still one
 * screenshot. Off-site images aren't ours to count.
 */
function countPictures(html) {
    const seen = new Set();
    for (const [, url] of String(html).matchAll(PICTURE_REF)) {
        if (/^(?:[a-z]+:)?\/\//i.test(url)) continue;
        seen.add(url.split(/[?#]/)[0].toLowerCase());
    }
    return seen.size;
}

/**
 * Everything the stats page and the index footer report, measured once per build.
 *
 * src/index.html is the registry: each `h2[id]` opens a game section, and the
 * links under it are that game's maps in release order. A link is a map the site
 * intends to cover; `.disabled` means the guide isn't written yet (the build
 * serves those a placeholder, so their words aren't readable and don't count);
 * `.solver-link` is a tool, not a guide. Reading it here means the stats can
 * never disagree with the index: one list, one source.
 *
 * Per guide the counts come from the authored source, not the rendered page, for
 * the same reason the footer's does: transforms add chrome after the layout runs.
 */
let statsCache = null;
function siteStats() {
    if (statsCache) return statsCache;

    const srcDir = path.join(__dirname, "../../src");
    const games = [];
    const guides = [];
    let solverCount = 0;

    // Without the index there is no roster to measure. Rather than hand-copy the
    // result shape into a second literal that drifts, fall through with no games:
    // every aggregate below is already defined over empty arrays.
    let doc = null;
    try {
        doc = new JSDOM(fs.readFileSync(path.join(srcDir, "index.html"), "utf8")).window.document;
    } catch (e) {
        console.warn("Couldn't read src/index.html, stats will be empty:", e.message);
    }

    // A remastered map (Nacht, Kino, Origins…) is listed under both the game it
    // shipped in and the one that remastered it. Its roster slot counts for each
    // game (that's what coverage means), but the guide itself is measured once,
    // so the per-game word totals still add up to the site total.
    //
    // The index runs newest game first, so walking the sections BOTTOM-TO-TOP
    // reaches a map's original game before any remaster of it: Der Riese counts
    // as World at War, not Black Ops 3, and that's the game its row in the table
    // names.
    const measured = new Map();
    const allMaps = new Set();

    for (const heading of doc ? [...doc.querySelectorAll("h2[id]")].reverse() : []) {
        const game = { key: heading.id, label: heading.textContent.trim(), planned: 0, written: 0, words: 0, pictures: 0 };
        // The maps of a game are the links between this <h2> and the next one.
        for (let el = heading.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
            for (const link of el.querySelectorAll("a[href]")) {
                if (link.classList.contains("solver-link")) { solverCount += 1; continue; }
                const href = link.getAttribute("href").split(/[?#]/)[0].replace(/^\//, "");
                if (!href.startsWith("games/")) continue;

                allMaps.add(href);
                game.planned += 1;
                if (link.classList.contains("disabled")) continue; // not written yet

                if (measured.has(href)) {
                    // Already measured under an earlier game: coverage only.
                    if (measured.get(href)) game.written += 1;
                    continue;
                }

                const file = path.join(srcDir, href + ".html");
                if (!fs.existsSync(file)) { measured.set(href, false); continue; }
                const raw = fs.readFileSync(file, "utf8");
                // Strip the YAML frontmatter so its keys don't count as prose.
                const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
                const words = countWords(body);
                if (words < WORDCOUNT_FLOOR) { measured.set(href, false); continue; } // a stub

                const pictures = countPictures(body);
                const cacheKey = "src/" + href + ".html";
                const steps = (body.match(/<li[\s>]/g) || []).length;

                guides.push({
                    name: link.textContent.trim(),
                    game: game.key,
                    gameLabel: game.label,
                    url: "/" + href,
                    words,
                    steps,
                    pictures,
                    videos: (body.match(/youtube|youtu\.be|<video[\s>]/gi) || []).length,
                    tables: (body.match(/<table[\s>]/g) || []).length,
                    sections: (body.match(/class="content-container"/g) || []).length,
                    edits: editcountCache[cacheKey] || 0,
                    updated: (lastmodCache[cacheKey] || "").slice(0, 10),
                    released: (releaseCache[cacheKey] || "").slice(0, 10),
                    // How much prose each step carries: the "verbosity" of a guide.
                    density: steps ? words / steps : 0,
                });

                measured.set(href, true);
                game.written += 1;
                game.words += words;
                game.pictures += pictures;
            }
        }
        if (game.planned) games.push(game);
    }

    guides.sort((a, b) => b.words - a.words);
    const byYear = releasesByYear(guides);
    const sum = (key) => guides.reduce((n, g) => n + g[key], 0);
    const top = (key) => guides.reduce((best, g) => (!best || g[key] > best[key] ? g : best), null);

    statsCache = {
        totals: {
            words: sum("words"),
            guides: guides.length,
            // Distinct maps, so a remaster listed under two games counts once.
            planned: allMaps.size,
            solvers: solverCount,
            steps: sum("steps"),
            pictures: sum("pictures"),
            videos: sum("videos"),
            tables: sum("tables"),
            sections: sum("sections"),
            edits: sum("edits"),
            games: games.length,
            avgWords: guides.length ? Math.round(sum("words") / guides.length) : 0,
            firstRelease: guides.reduce(
                (first, g) => (g.released && (!first || g.released < first) ? g.released : first),
                "",
            ),
        },
        guides,
        byWords: guides.slice(0, 10),
        byPictures: [...guides].sort((a, b) => b.pictures - a.pictures).slice(0, 10),
        // Filtered on words, not on `written`: a game whose only published maps
        // are remasters measured under their original game has nothing to plot.
        byGame: [...games].filter((g) => g.words > 0).sort((a, b) => b.words - a.words),
        byYear: byYear,
        // Nunjucks `set` inside a loop doesn't escape the loop, so the chart's
        // scale has to arrive precomputed.
        byYearMax: byYear.reduce((n, y) => Math.max(n, y.count), 0),
        coverage: [...games].sort((a, b) => b.written / b.planned - a.written / a.planned),
        extremes: {
            longest: guides[0] || null,
            shortest: guides[guides.length - 1] || null,
            mostSteps: top("steps"),
            mostPictures: top("pictures"),
            mostEdited: top("edits"),
            densest: top("density"),
        },
    };
    return statsCache;
}

/**
 * Guides grouped by the year they first went live, oldest first, with empty
 * years kept so the chart reads as a timeline rather than a ranking. Guides with
 * no recorded release date sit out: release-dates.json covers what shipped, and
 * a missing entry means "unknown", not "released in year zero".
 */
function releasesByYear(guides) {
    const counts = new Map();
    for (const g of guides) {
        if (!g.released) continue;
        const year = Number(g.released.slice(0, 4));
        counts.set(year, (counts.get(year) || 0) + 1);
    }
    if (counts.size === 0) return [];

    const years = [...counts.keys()];
    const out = [];
    for (let y = Math.min(...years); y <= Math.max(...years); y++) {
        out.push({ year: y, count: counts.get(y) || 0 });
    }
    return out;
}

function resetStats() {
    statsCache = null;
}

module.exports = { WORDCOUNT_FLOOR, countWords, siteStats, resetStats };
