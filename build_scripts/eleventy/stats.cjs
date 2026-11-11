const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const { lastmodCache, editcountCache, releaseCache } = require("./dates.cjs");

// Below this a page is a solver shell or stub: no footer count, no share of totals.
const WORDCOUNT_FLOOR = 100;

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

// Counted from HTML, not disk: images are gitignored (R2), so a Cloudflare checkout has none.
function countPictures(html) {
    const seen = new Set();
    for (const [, url] of String(html).matchAll(PICTURE_REF)) {
        if (/^(?:[a-z]+:)?\/\//i.test(url)) continue;
        seen.add(url.split(/[?#]/)[0].toLowerCase());
    }
    return seen.size;
}

/**
 * src/index.html is the registry: each `h2[id]` opens a game, the links under it
 * are its maps, `.disabled` = not written yet. Counts use authored source because
 * transforms add chrome to the rendered page.
 */
let statsCache = null;
function siteStats() {
    if (statsCache) return statsCache;

    const srcDir = path.join(__dirname, "../../src");
    const games = [];
    const guides = [];
    let solverCount = 0;

    let doc = null;
    try {
        doc = new JSDOM(fs.readFileSync(path.join(srcDir, "index.html"), "utf8")).window.document;
    } catch (e) {
        console.warn("Couldn't read src/index.html, stats will be empty:", e.message);
    }

    // Remasters are listed under two games: coverage for both, words measured once.
    // The index is newest-first, so walking it reversed credits the original game.
    const measured = new Map();
    const allMaps = new Set();

    for (const heading of doc ? [...doc.querySelectorAll("h2[id]")].reverse() : []) {
        const game = { key: heading.id, label: heading.textContent.trim(), planned: 0, written: 0, words: 0, pictures: 0 };
        for (let el = heading.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
            for (const link of el.querySelectorAll("a[href]")) {
                if (link.classList.contains("solver-link")) { solverCount += 1; continue; }
                const href = link.getAttribute("href").split(/[?#]/)[0].replace(/^\//, "");
                if (!href.startsWith("games/")) continue;

                allMaps.add(href);
                game.planned += 1;
                if (link.classList.contains("disabled")) continue;

                if (measured.has(href)) {
                    if (measured.get(href)) game.written += 1;
                    continue;
                }

                const file = path.join(srcDir, href + ".html");
                if (!fs.existsSync(file)) { measured.set(href, false); continue; }
                const raw = fs.readFileSync(file, "utf8");
                const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, "");
                const words = countWords(body);
                if (words < WORDCOUNT_FLOOR) { measured.set(href, false); continue; }

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
        // Filtered on words, not `written`: a remaster-only game has nothing to plot.
        byGame: [...games].filter((g) => g.words > 0).sort((a, b) => b.words - a.words),
        byYear: byYear,
        // Precomputed: Nunjucks `set` inside a loop doesn't escape the loop.
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
