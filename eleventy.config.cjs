const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const BUILD_VERSION = Date.now().toString();
let cachedManifest = null;

// Git-based last-modified dates, kept fresh by GitHub Actions (refresh-lastmod-cache.cjs).
// Same source the sitemap uses. Keyed by repo-root-relative path, e.g. "src/index.html".
let lastmodCache = {};
try {
    lastmodCache = require("./build_scripts/lastmod-cache.json");
} catch {
    console.warn("lastmod-cache.json not found; footer 'last updated' dates will be omitted.");
}

// Commits-per-file ("edit count"), from the same refresh script as lastmodCache.
let editcountCache = {};
try {
    editcountCache = require("./build_scripts/editcount-cache.json");
} catch {
    console.warn("editcount-cache.json not found; footer edit counts will be omitted.");
}

// Initial-release dates, same key shape as lastmodCache. Unlike the two caches
// above this one is NOT regenerated on CI: half of it was recovered from the old
// zombiesGuides repo's history, which doesn't exist on the build server. It is
// committed data, refreshed by hand via derive-release-dates.cjs. Pages absent
// from it (unreleased guides, the index) simply render no release date.
let releaseCache = {};
try {
    releaseCache = require("./build_scripts/release-dates.json");
} catch {
    console.warn("release-dates.json not found; footer release dates will be omitted.");
}

/**
 * "2026-05-11" -> "May 11, 2026". Formatted in UTC off the leading calendar date
 * so the build server's timezone (UTC on Cloudflare) can't shift an evening-local
 * date onto the next day.
 */
function formatCalendarDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
    });
}

/** Normalize a page's inputPath ("./src/index.html") to a cache key ("src/index.html"). */
function cacheKeyFor(inputPath) {
    return inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * "2026-05-11" -> "3 days ago" / "last month" / "2 years ago".
 *
 * Baked in at build time, so it would drift as the deploy ages; relative-time.ts
 * re-renders it in the browser against the reader's own clock. Keep this bucket
 * ladder and the one there in sync, or pages visibly reword when the script runs.
 */
const relativeFmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function formatRelativeDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const now = new Date();
    // Compare calendar date to calendar date, both sides pinned to UTC noon so
    // no timezone or DST shift can nudge the difference across a day boundary.
    const then = Date.UTC(y, m - 1, d);
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.max(0, Math.round((today - then) / 86400000));

    if (days < 1) return "today";
    if (days < 7) return relativeFmt.format(-days, "day");
    if (days < 31) return relativeFmt.format(-Math.round(days / 7), "week");
    if (days < 365) return relativeFmt.format(-Math.max(1, Math.round(days / 30.44)), "month");
    return relativeFmt.format(-Math.max(1, Math.round(days / 365.25)), "year");
}

// ========================================
// WORD COUNTS
// ========================================

// Below this a page is a solver shell or a stub, not something with a readable
// length worth quoting, so it gets no footer count and no share of the total.
const WORDCOUNT_FLOOR = 100;

/**
 * Words of visible prose in a chunk of page HTML. Comments, <script>/<style>/
 * <template> bodies and every tag (with its attributes, so class names, hrefs
 * and alt text never count) are dropped before tokenizing. A word starts with
 * a letter or digit; inner apostrophes and hyphens keep "Pack-a-Punch" and
 * "Hell's" as one word each.
 */
function countWords(html) {
    if (!html) return 0;
    const text = String(html)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&[a-z#0-9]+;/gi, "");
    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    return words ? words.length : 0;
}

const PICTURE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

/** Every file under `dir` (recursively) whose name passes `keep`. */
function walkFiles(dir, keep, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, keep, results);
        else if (keep(entry.name)) results.push(full);
    }
    return results;
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

    const srcDir = path.join(__dirname, "src");
    const games = [];
    const guides = [];
    let solverCount = 0;

    let doc;
    try {
        doc = new JSDOM(fs.readFileSync(path.join(srcDir, "index.html"), "utf8")).window.document;
    } catch (e) {
        console.warn("Couldn't read src/index.html, stats will be empty:", e.message);
        statsCache = emptyStats();
        return statsCache;
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

    for (const heading of [...doc.querySelectorAll("h2[id]")].reverse()) {
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

                const pictures = walkFiles(
                    path.dirname(file),
                    (n) => PICTURE_EXTENSIONS.has(path.extname(n).toLowerCase()),
                ).length;
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

function emptyStats() {
    return {
        totals: { words: 0, guides: 0, planned: 0, solvers: 0, steps: 0, pictures: 0, videos: 0, tables: 0, sections: 0, edits: 0, games: 0, avgWords: 0, firstRelease: "" },
        guides: [], byWords: [], byPictures: [], byGame: [], byYear: [], byYearMax: 0, coverage: [],
        extremes: { longest: null, shortest: null, mostSteps: null, mostPictures: null, mostEdited: null, densest: null },
    };
}

// ========================================
// TRANSFORM FUNCTIONS
// ========================================

/**
 * Eleventy transform to auto-generate quick links navigation
 * Scans page content and builds table of contents in .quick-links-container
 */
function generateQuickLinks(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    // const t0 = Date.now();
    try {
        const dom = new JSDOM(content);
        const document = dom.window.document;

        // Skip TOC generation if the page opts out
        if (document.body?.dataset?.skipToc === "true") return content;

        let container = document.querySelector(".quick-links-container");
        if (!container) {
            // Create the container and insert it before the first .content-container
            container = document.createElement("div");
            container.className = "quick-links-container";
            const firstSection = document.querySelector(".content-container");
            if (!firstSection) return content;
            firstSection.parentNode.insertBefore(container, firstSection);
        }

        // Clear existing manual content
        container.innerHTML = "";

        // Build navigation from page structure
        const navStructure = buildNavStructure(document);
        renderNavigation(container, navStructure, outputPath);

        const result = dom.serialize();
        // console.log(`[generateQuickLinks] ${outputPath} in ${Date.now() - t0}ms`);
        return result;
    } catch (error) {
        console.error(`Error generating quick links for ${outputPath}:`, error.message);
        return content;
    }
}

/**
 * Builds navigation structure from page content
 * Groups items by section header
 */
function buildNavStructure(document) {
    const sections = [];
    const containers = document.querySelectorAll("div.content-container");
    let currentSection = null;

    for (const container of containers) {
        if (shouldExcludeFromNav(container)) continue;

        // Check if this container starts a new section
        if (container.dataset.sectionInd) {
            const sectionLevel = container.dataset.sectionHeaderLevel || "0";

            // Create new section
            currentSection = {
                sectionTitle: container.dataset.sectionInd,
                sectionLevel,
                items: [],
            };
            sections.push(currentSection);
        }

        // If no section exists yet, create a default one
        if (!currentSection) {
            currentSection = {
                sectionTitle: null,
                sectionLevel: "0",
                items: [],
            };
            sections.push(currentSection);
        }

        // Add main container link to current section
        currentSection.items.push({
            element: container,
            indent: 0,
            isMain: true,
        });

        // Find sub-items within this container
        const subItems = container.querySelectorAll("p.title-tier-2, p.title-tier-3, p.title-tier-4");

        for (const [index, subItem] of subItems.entries()) {
            if (shouldExcludeFromNav(subItem)) continue;

            // Calculate indent level. tier-4 looks like tier-3 but nests one
            // level deeper in the Contents list.
            let indent = 1;
            if (subItem.classList.contains("title-tier-4") && index !== 0) {
                indent = 2;
            }
            if (subItem.dataset.customIndent) {
                indent = parseInt(subItem.dataset.customIndent, 10);
            }

            // Handle multiple links for same element
            if (subItem.dataset.customQuickLink) {
                const names = subItem.dataset.customQuickLink.split(";");
                if (!subItem.id) subItem.id = names[0]; // Set ID from first name

                for (const name of names) {
                    currentSection.items.push({
                        element: subItem,
                        indent,
                        customName: name,
                    });
                }
            } else {
                currentSection.items.push({
                    element: subItem,
                    indent,
                });
            }
        }
    }

    return sections;
}

/**
 * Renders navigation structure to DOM
 */
function renderNavigation(container, structure, outputPath) {
    const document = container.ownerDocument;

    for (const section of structure) {
        // Add section header
        if (section.sectionTitle) {
            const header = document.createElement(section.sectionLevel === "0" ? "h2" : "h4");
            if (section.sectionLevel !== "0") {
                header.className = "sub-header";
            }
            header.textContent = section.sectionTitle;
            container.appendChild(header);
        }

        // Create ONE list for this entire section
        const rootList = document.createElement("ul");
        container.appendChild(rootList);

        // Process all items in this section
        let currentIndent = 0;
        const listStack = [rootList];

        for (const item of section.items) {
            const link = createNavLink(document, item.element, item.customName, outputPath);
            if (!link) continue;

            // Adjust nesting level based on indent
            while (currentIndent < item.indent) {
                const nestedList = document.createElement("ul");
                const lastItem = listStack[listStack.length - 1].lastElementChild;

                if (lastItem) {
                    lastItem.appendChild(nestedList);
                } else {
                    // No parent item, create dummy
                    const dummyItem = document.createElement("li");
                    dummyItem.style.display = "none";
                    listStack[listStack.length - 1].appendChild(dummyItem);
                    dummyItem.appendChild(nestedList);
                }

                listStack.push(nestedList);
                currentIndent++;
            }

            while (currentIndent > item.indent && listStack.length > 1) {
                listStack.pop();
                currentIndent--;
            }

            listStack[listStack.length - 1].appendChild(link);
        }
    }
}

/**
 * Creates a navigation link element
 */
function createNavLink(document, element, customName = null, _outputPath = "") {
    if (!element.id) {
        // console.warn(`[${outputPath}] Quick link element missing ID: ${element.textContent?.substring(0, 50)}`);
        return null;
    }

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${element.id}`;

    // Determine link text
    if (customName) {
        a.textContent = customName;
    } else if (element.dataset.customTitle) {
        a.textContent = element.dataset.customTitle;
    } else if (element.children.length > 0) {
        a.textContent = element.children[0].textContent;
    } else {
        a.textContent = element.textContent;
    }

    li.appendChild(a);
    return li;
}

/**
 * Checks if element should be excluded from navigation
 */
function shouldExcludeFromNav(element) {
    const excludedClasses = [
        "solver-container",
        "stats",
        "weapon-desc",
        "warning",
        "solver-output",
        "solver-symbol-select",
        "aligned-buttons",
        "aligned-label",
    ];

    // Check element and all ancestors for excluded classes
    let current = element;
    while (current) {
        if (current.classList) {
            for (const className of excludedClasses) {
                if (current.classList.contains(className)) return true;
            }
        }
        current = current.parentElement;
    }

    return element.dataset?.boolQuickLink === "false";
}

/**
 * Eleventy transform to classify links and add appropriate CSS classes
 * Runs on all HTML output files
 */
function classifyLinks(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    // const t0 = Date.now();
    try {
        // Extract quick-links-container so its internal anchor links are not reclassified
        let qlSection = "";
        let processable = content;
        const PLACEHOLDER = "\x00QL\x00";

        const qlIdx = content.indexOf("class=\"quick-links-container\"");
        if (qlIdx !== -1) {
            const divStart = content.lastIndexOf("<div", qlIdx);
            if (divStart !== -1) {
                let depth = 0, pos = divStart;
                while (pos < content.length) {
                    if (content[pos] === "<") {
                        if (content.startsWith("<div", pos) && /[\s>]/.test(content[pos + 4])) {
                            depth++;
                            pos += 4;
                        } else if (content.startsWith("</div>", pos)) {
                            if (--depth === 0) {
                                qlSection = content.slice(divStart, pos + 6);
                                processable = content.slice(0, divStart) + PLACEHOLDER + content.slice(pos + 6);
                                break;
                            }
                            pos += 6;
                        } else pos++;
                    } else pos++;
                }
            }
        }

        const VALID_EXTS = [".webp", ".html", ".webm", ".gif", ".jpg", ".jpeg", ".png", ".mp4", ".flac", ".mp3", ".ogg", ".wav", ".m4a"];
        const LIGHTBOX_EXTS = new Set([".webp", ".jpg", ".jpeg", ".png", ".gif", ".webm", ".mp4", ".mov", ".flac", ".mp3", ".ogg", ".wav", ".m4a"]);
        const LIGHTBOX_VIDEO_EXTS = new Set([".webm", ".mp4", ".mov"]);
        const LIGHTBOX_AUDIO_EXTS = new Set([".flac", ".mp3", ".ogg", ".wav", ".m4a"]);
        let modified = false;

        const result = processable.replace(/<a(\s[^>]*)>/gi, (match, attrs) => {
            const hrefMatch = /href=["']([^"']*)["']/i.exec(attrs);
            if (!hrefMatch) return match;
            const href = hrefMatch[1];
            let overrideHref = null;

            const classMatch = /class=["']([^"']*)["']/i.exec(attrs);
            const existing = new Set(classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : []);
            const sizeBefore = existing.size;

            if (href.includes("#")) {
                if (href.startsWith("#")) {
                    existing.add("link-to-page");
                } else {
                    existing.add("internal-link");
                }
            }

            const isExternal =
                href.includes("youtu.be") || href.includes("youtube") ||
                href.includes("discord.com") || href.startsWith("http://") ||
                href.startsWith("https://") ||
                (href.includes(".com") && !href.startsWith("/"));

            if (isExternal) existing.add("external-link");

            // For external links: ensure target="_blank" + rel="noopener noreferrer nofollow".
            // Preserves any pre-existing target value and merges rel tokens.
            let needsTarget = false;
            let computedRel = null;
            if (isExternal) {
                needsTarget = !/\btarget=["'][^"']*["']/i.test(attrs);
                const relMatch = /\brel=["']([^"']*)["']/i.exec(attrs);
                const relTokens = new Set(relMatch ? relMatch[1].split(/\s+/).filter(Boolean) : []);
                const required = ["noopener", "noreferrer", "nofollow"];
                const missing = required.filter((r) => !relTokens.has(r));
                if (missing.length > 0) {
                    for (const r of required) relTokens.add(r);
                    computedRel = [...relTokens].join(" ");
                }
            }

            if (!href.startsWith("#") && !href.startsWith("http")) {
                if (href.endsWith("/")) {
                    existing.add("incomplete-path");
                    overrideHref = "#";
                    console.warn(`Incomplete path in ${outputPath}: ${href}`);
                } else {
                    const pathWithoutQuery = href.split("?")[0];
                    const hasUnknownExt = /\.[a-z0-9]+$/i.test(pathWithoutQuery);
                    const hasKnownExt = VALID_EXTS.some((ext) => pathWithoutQuery.toLowerCase().endsWith(ext));
                    if (hasUnknownExt && !hasKnownExt) {
                        existing.add("wrong_file_type");
                        console.warn(`Invalid file type in ${outputPath}: ${href}`);
                    }
                }
            }

            const hrefLower = href.toLowerCase().split("?")[0];
            const hrefExt = hrefLower.match(/\.[a-z0-9]+$/)?.[0];
            let dataMediaType = null;
            if (hrefExt && LIGHTBOX_EXTS.has(hrefExt)) {
                existing.add("lightbox-trigger");
                dataMediaType = LIGHTBOX_VIDEO_EXTS.has(hrefExt)
                    ? "video"
                    : LIGHTBOX_AUDIO_EXTS.has(hrefExt)
                        ? "audio"
                        : "image";
            }

            if (
                existing.size === sizeBefore &&
                overrideHref === null &&
                dataMediaType === null &&
                !needsTarget &&
                computedRel === null
            ) return match;

            modified = true;
            const classStr = [...existing].join(" ");
            let newAttrs = classMatch
                ? attrs.replace(/class=["'][^"']*["']/i, `class="${classStr}"`)
                : ` class="${classStr}"${attrs}`;
            if (overrideHref !== null) {
                newAttrs = newAttrs.replace(/href=["'][^"']*["']/i, `href="${overrideHref}"`);
            }
            if (dataMediaType !== null && !/data-media-type=/i.test(newAttrs)) {
                newAttrs += ` data-media-type="${dataMediaType}"`;
            }
            if (needsTarget) {
                newAttrs += ` target="_blank"`;
            }
            if (computedRel !== null) {
                if (/\brel=["'][^"']*["']/i.test(newAttrs)) {
                    newAttrs = newAttrs.replace(/\brel=["'][^"']*["']/i, `rel="${computedRel}"`);
                } else {
                    newAttrs += ` rel="${computedRel}"`;
                }
            }
            return `<a${newAttrs}>`;
        });

        const final = qlSection ? result.replace(PLACEHOLDER, qlSection) : result;
        // console.log(`[classifyLinks] ${outputPath} in ${Date.now() - t0}ms`);
        return modified ? final : content;
    } catch (error) {
        console.error(`Error classifying links in ${outputPath}:`, error.message);
        return content;
    }
}

/**
 * Eleventy transform: turn links to unwritten guides into plain text.
 *
 * Guides that don't exist yet are authored as `<a class="disabled" href="...">`
 * so the href is already in place for whenever the guide lands. This renames
 * that href to data-href in the output, which makes it an anchor with nowhere
 * to go: it can't be followed, focused or middle-clicked, and crawlers stop
 * seeing links to pages that aren't there. Because it's no longer a link, CSS
 * can style hover on the name itself (see `.disabled` in components.css)
 * instead of blocking pointer events wholesale.
 *
 * Runs last, so classifyLinks and addVersioning still see the real href.
 */
function unlinkUnwrittenGuides(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    if (!content.includes("disabled")) return content;

    let modified = false;
    const result = content.replace(/<a\s[^>]*>/gi, (tag) => {
        // Exact class token only: `btn--disabled` or `is-disabled` must not match.
        // Leading `\s` keeps this off attributes that merely end in "class".
        const classAttr = /\sclass=["']([^"']*)["']/i.exec(tag);
        if (!classAttr || !classAttr[1].split(/\s+/).includes("disabled")) return tag;
        // `\s` before href so an already-renamed data-href is left alone.
        if (!/\shref=/i.test(tag)) return tag;
        modified = true;
        return tag.replace(/(\s)href=/i, "$1data-href=");
    });
    return modified ? result : content;
}

/**
 * Eleventy transform to add version parameters to CSS and JS links
 * and add version display component
 */
function addVersioning(content, outputPath) {
    // Only process HTML files
    if (!outputPath || !outputPath.endsWith(".html")) {
        return content;
    }

    // const t0 = Date.now();
    try {
        let modified = content;
        const buildVersion = BUILD_VERSION;

        // Add ?v= parameter to CSS links without version
        modified = modified.replace(
            /<link([^>]*)href=["']([^"']+\.css)["']([^>]*)>/gi,
            (match, before, href, after) => {
                if (!href.includes("?v=")) {
                    return `<link${before}href="${href}?v=${buildVersion}"${after}>`;
                }
                return match;
            },
        );

        // Add ?v= parameter to JS script tags without version
        modified = modified.replace(/<script([^>]*)src=["']([^"']+\.js)["']([^>]*)>/gi, (match, before, src, after) => {
            if (!src.includes("?v=")) {
                // Also add defer if not present and not a module script
                if (!match.includes("defer") && !match.includes("type=\"module\"")) {
                    return `<script${before}src="${src}?v=${buildVersion}"${after} defer>`;
                }
                return `<script${before}src="${src}?v=${buildVersion}"${after}>`;
            }
            return match;
        });

        // Add version display component to index.html and guide pages (but not solvers)
        const fileName = outputPath.split(/[/\\]/).pop();
        const isIndexOrGuide = fileName === "index.html" || outputPath.includes("games");
        const isSolverOrTemplate = outputPath.includes("solver") || outputPath.includes("_template");

        if (isIndexOrGuide && !isSolverOrTemplate && !modified.includes("version-display")) {
            const versionDisplayComponent = `<!-- Version display component -->
<div class="version-display" data-version="${buildVersion}">
    v.<span id="version-number">${buildVersion}</span>
</div>`;

            // Insert after opening <body> tag
            if (modified.includes("<body>")) {
                modified = modified.replace("<body>", `<body>\n${versionDisplayComponent}\n`);
            }
        }

        // console.log(`[addVersioning] ${outputPath} in ${Date.now() - t0}ms`);
        return modified;
    } catch (error) {
        console.error(`Error adding versioning to ${outputPath}:`, error.message);
        return content;
    }
}

/**
 * Eleventy transform to inject React bundle references from Vite manifest
 * This replaces the need for post-build scripts to update bundle hashes
 */
function injectReactBundle(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    // Only process files that need React bundle injection
    if (
        !content.includes("<!-- REACT_BUNDLE_PLACEHOLDER -->") &&
        !content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")
    ) {
        return content;
    }

    // const t0 = Date.now();
    try {
        if (!cachedManifest) {
            const manifestPath = path.join(__dirname, "dist/react-solvers/.vite/manifest.json");
            if (!fs.existsSync(manifestPath)) {
                console.warn("⚠️  React manifest not found - skipping bundle injection");
                return content;
            }
            cachedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        }

        const manifest = cachedManifest;
        // Vite manifest structure: { "index.html": { "file": "assets/index-HASH.js", ... } }
        const indexEntry = manifest["index.html"];
        if (!indexEntry || !indexEntry.file) {
            console.error("❌ Could not find index.html entry in Vite manifest");
            return content;
        }

        const bundlePath = `/react-solvers/${indexEntry.file}`;
        let modified = content;

        // Handle modulepreload link
        if (content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")) {
            const link = `<link rel="modulepreload" href="${bundlePath}" />`;
            modified = modified.replace("<!-- REACT_BUNDLE_MODULEPRELOAD -->", link);
        }

        // Handle script tag
        if (content.includes("<!-- REACT_BUNDLE_PLACEHOLDER -->")) {
            const scriptTag = `<script type="module" src="${bundlePath}"></script>`;
            modified = modified.replace("<!-- REACT_BUNDLE_PLACEHOLDER -->", scriptTag);
        }

        // console.log(`[injectReactBundle] ${outputPath} in ${Date.now() - t0}ms`);
        return modified;
    } catch (error) {
        console.error(`❌ Error injecting React bundle in ${outputPath}:`, error.message);
        return content;
    }
}

function wrapTables(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    try {
        const dom = new JSDOM(content);
        const document = dom.window.document;
        const tables = document.querySelectorAll("table");
        if (!tables.length) return content;
        let modified = false;
        for (const table of tables) {
            if (table.parentElement?.classList.contains("table-scroll")) continue;
            const wrapper = document.createElement("div");
            wrapper.className = "table-scroll";
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
            modified = true;
        }
        return modified ? dom.serialize() : content;
    } catch (e) {
        console.error(`Error wrapping tables in ${outputPath}:`, e.message);
        return content;
    }
}

function preRenderRevealButtons(content, outputPath) {
    if (!outputPath?.endsWith(".html"))
        return content;

    const dom = new JSDOM(content);
    const elements = dom.window.document.querySelectorAll("[data-reveal-label]");
    if (!elements.length) return content;

    for (const el of elements) {
        const label =
            el.getAttribute("data-reveal-label");
        const inner = el.innerHTML;
        el.innerHTML = `<button type="button" class="btn--reveal">${label}</button>
<div class="button-activated-div" style="display: none;">${inner}</div>`;
    }
    return dom.serialize();
}

/**
 * Expands a `data-path-group` block into a segmented tab switcher.
 *
 * Authored form — direct children carrying `data-path-label` become the paths,
 * and the one marked `data-path-default` is the one shown on load:
 *
 *   <div class="path-tabs" data-path-group="chemistry-step">
 *     <div id="..." data-path-label="Solver Way" data-path-note="Recommended" data-path-default>…</div>
 *     <div id="..." data-path-label="Intended Way" data-path-note="Tedious">…</div>
 *   </div>
 *
 * The authored elements become the panels themselves rather than being wrapped,
 * so any `id` on them stays a valid anchor target. Interaction lives in
 * src/ts/content/path-tabs.ts.
 */
function preRenderPathTabs(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    if (!content.includes("data-path-group")) return content;

    try {
        const dom = new JSDOM(content);
        const document = dom.window.document;
        const groups = document.querySelectorAll("[data-path-group]");
        if (!groups.length) return content;

        for (const group of groups) {
            const groupName = group.getAttribute("data-path-group");
            const paths = Array.from(group.children).filter((el) => el.hasAttribute("data-path-label"));

            // A switcher needs something to switch between.
            if (paths.length < 2) {
                console.warn(
                    `[preRenderPathTabs] "${groupName}" in ${outputPath} has ${paths.length} path(s); skipping.`,
                );
                continue;
            }

            const defaultIndex = Math.max(
                0,
                paths.findIndex((el) => el.hasAttribute("data-path-default")),
            );

            group.classList.add("path-tabs");

            const bar = document.createElement("div");
            bar.className = "path-tabs__bar";
            bar.setAttribute("role", "tablist");

            const panels = document.createElement("div");
            panels.className = "path-tabs__panels";

            paths.forEach((path, index) => {
                const isDefault = index === defaultIndex;
                const tabId = `path-${groupName}-tab-${index}`;
                const panelId = `path-${groupName}-panel-${index}`;
                const label = path.getAttribute("data-path-label");
                const note = path.getAttribute("data-path-note");

                const tab = document.createElement("button");
                tab.type = "button";
                tab.id = tabId;
                tab.className = `path-tabs__tab${isDefault ? " is-active" : ""}`;
                tab.setAttribute("role", "tab");
                tab.setAttribute("aria-controls", panelId);
                tab.setAttribute("aria-selected", String(isDefault));
                tab.tabIndex = isDefault ? 0 : -1;
                tab.innerHTML =
                    `<span class="path-tabs__label">${label}</span>` +
                    (note ? `<span class="path-tabs__note">${note}</span>` : "");
                bar.appendChild(tab);

                path.classList.add("path-tabs__panel");
                path.setAttribute("role", "tabpanel");
                path.setAttribute("aria-labelledby", tabId);

                // Deep links to a panel should land on the tab bar, not on the
                // panel's first line — otherwise the tabs sit off-screen and the
                // reader can't tell there's another route. See resolveScrollTarget
                // in src/ts/navigation/scroll-manager.ts.
                path.setAttribute("data-scroll-with", ".path-tabs");
                if (!path.id) path.id = panelId;
                if (!isDefault) path.setAttribute("hidden", "");
                path.removeAttribute("data-path-label");
                path.removeAttribute("data-path-note");
                path.removeAttribute("data-path-default");
                panels.appendChild(path);
            });

            group.prepend(bar);
            bar.after(panels);
        }

        return dom.serialize();
    } catch (e) {
        console.error(`Error building path tabs in ${outputPath}:`, e.message);
        return content;
    }
}

// ========================================
// SMART IMAGE COPY
// ========================================

// Extensions eligible for the smart asset copy below (not strictly images, also
// includes video, audio, and a few root-level static files).
const IMAGE_EXTENSIONS = new Set([
    ".webp", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webm", ".ico", ".xml", ".txt",
    ".flac", ".mp3", ".ogg", ".wav", ".m4a",
]);

function walkDir(dir, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, results);
        } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            results.push(fullPath);
        }
    }
    return results;
}

function shouldCopy(src, dest) {
    if (!fs.existsSync(dest)) return true;
    return fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
}

async function smartCopyImages() {
    const pairs = [
        // src/games/**/* → dist/games/**/
        ...walkDir("src/games").map((src) => ({
            src,
            dest: path.join("dist", path.relative("src", src)),
        })),
        // src root-level assets → dist/
        ...fs.readdirSync("src", { withFileTypes: true })
            .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
            .map((e) => ({ src: path.join("src", e.name), dest: path.join("dist", e.name) })),
    ];

    // Decide what actually needs copying (mtime check), then pre-create the unique
    // destination directories once so the concurrent copies below never race on mkdir.
    const todo = pairs.filter(({ src, dest }) => shouldCopy(src, dest));
    const skipped = pairs.length - todo.length;
    for (const dir of new Set(todo.map(({ dest }) => path.dirname(dest)))) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Copy concurrently. The bottleneck on a clean build (e.g. Cloudflare, which
    // starts from an empty dist every deploy) is per-file syscall latency across
    // thousands of images, not raw throughput, so a worker pool hides that latency
    // and cuts a cold copy from ~100s to a fraction of that.
    const CONCURRENCY = 32;
    let next = 0;
    async function worker() {
        while (next < todo.length) {
            const { src, dest } = todo[next++];
            await fs.promises.copyFile(src, dest);
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    console.log(`[smartCopyImages] ${todo.length} copied, ${skipped} skipped (unchanged)`);
}

// ========================================
// ELEVENTY CONFIGURATION
// ========================================

module.exports = function(eleventyConfig) {
    // Add transforms for quick links generation, link classification, versioning, and React bundle injection
    eleventyConfig.addTransform("wrapTables", wrapTables);
    eleventyConfig.addTransform("preRenderRevealButtons", preRenderRevealButtons);
    eleventyConfig.addTransform("preRenderPathTabs", preRenderPathTabs);
    eleventyConfig.addTransform("generateQuickLinks", generateQuickLinks);
    eleventyConfig.addTransform("classifyLinks", classifyLinks);
    eleventyConfig.addTransform("addVersioning", addVersioning);
    eleventyConfig.addTransform("injectReactBundle", injectReactBundle);
    eleventyConfig.addTransform("unlinkUnwrittenGuides", unlinkUnwrittenGuides);

    // Performance optimization: use passthrough for dev server (faster)
    eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

    // Smart image copy: only copies new or changed files
    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Passthrough copy static assets (non-image)
    eleventyConfig.addPassthroughCopy("src/css/*");
    eleventyConfig.addPassthroughCopy("src/js");
    eleventyConfig.addPassthroughCopy("src/favicon");
    eleventyConfig.addPassthroughCopy("src/font");
    // NOT src/react-solvers — Vite already builds that directory into
    // dist/react-solvers (see vite.config.js `outDir`), and it runs before
    // Eleventy. Copying the source tree on top of it published every solver's
    // .tsx source plus a stale nested dist/ (bundle + 1.2MB sourcemap) to the
    // live site, and overwrote Vite's built index.html with the source one that
    // points at /src/main.tsx. Production needs only Vite's assets/ output.
    eleventyConfig.addPassthroughCopy("src/_headers");
    eleventyConfig.addPassthroughCopy("src/_redirects");

    // Preserve .html file extensions instead of using directory index
    eleventyConfig.addGlobalData("permalink", () => {
        return (data) => {
            // Keep the exact file path with .html extension
            if (data.page.inputPath.includes(".html")) {
                return data.page.filePathStem + ".html";
            }
            return data.page.url;
        };
    });

    // Strip .html extension from URLs so canonicals match Cloudflare Pretty URLs
    eleventyConfig.addFilter("cleanUrl", (url) => url ? url.replace(/\.html$/, "") : url);

    // Add a filter to format dates
    eleventyConfig.addFilter("dateFormat", function(date) {
        return new Date(date).toLocaleDateString();
    });

    // Add a shortcode for the current year (useful for copyright)
    eleventyConfig.addShortcode("year", () => `${new Date().getFullYear()}`);

    // Given a page's inputPath (e.g. "./src/index.html"), return the bare calendar
    // date git recorded for it ("2026-05-11"). Empty string if unknown.
    eleventyConfig.addFilter("lastmodISO", (inputPath) => {
        if (!inputPath) return "";
        return (lastmodCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // Same date formatted like "May 11, 2026", for the footer's hover tooltip.
    eleventyConfig.addFilter("lastmod", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The day the page first went live, from release-dates.json. Empty string for
    // anything not in there (an unreleased guide, a solver that never had its own
    // launch, the index), so the footer skips it rather than inventing a date.
    eleventyConfig.addFilter("releasedISO", (inputPath) => {
        if (!inputPath) return "";
        return (releaseCache[cacheKeyFor(inputPath)] || "").slice(0, 10);
    });

    // Same date as "October 9, 2025". Absolute, not relative like `Updated`: a
    // first-release date is a fact about the page, not news about it.
    eleventyConfig.addFilter("released", (inputPath) => {
        if (!inputPath) return "";
        return formatCalendarDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // "2023-07-29" -> "July 29, 2023", for dates that arrive as bare ISO strings
    // rather than as a page path (the stats page's aggregates).
    eleventyConfig.addFilter("calendarDate", (iso) => formatCalendarDate(iso));

    // Same date as "3 days ago" / "last month" / "2 years ago", for the footer's
    // visible text.
    eleventyConfig.addFilter("lastmodRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(lastmodCache[cacheKeyFor(inputPath)]);
    });

    // The release date as an age, for the footer's hover tooltip. The visible
    // text is the absolute date, so the tooltip carries what that date means now.
    eleventyConfig.addFilter("releasedRelative", (inputPath) => {
        if (!inputPath) return "";
        return formatRelativeDate(releaseCache[cacheKeyFor(inputPath)]);
    });

    // Given a page's inputPath, return how many commits have touched it (its
    // "edit count") from editcount-cache.json. Null if unknown, so the template
    // can skip rendering rather than show "0 edits".
    eleventyConfig.addFilter("editcount", (inputPath) => {
        if (!inputPath) return null;
        return editcountCache[cacheKeyFor(inputPath)] || null;
    });

    // Word count of a page's own body HTML, for the footer. Counts the content
    // as authored: transforms (quick links, reveal-button chrome, table
    // wrappers) all run after the layout renders, so none of that chrome is in
    // this string to inflate the number. Returns null below a floor so solver
    // shells and stubs render no count at all rather than "12 words".
    eleventyConfig.addFilter("wordcount", (html) => {
        const n = countWords(html);
        return n >= WORDCOUNT_FLOOR ? n : null;
    });

    // Per-guide and site-wide measurements, for the index footer and /stats.
    eleventyConfig.addGlobalData("siteWords", () => siteStats().totals);
    eleventyConfig.addGlobalData("stats", siteStats);

    // Compact big numbers for tight spots: 149438 -> "149.4K".
    eleventyConfig.addFilter("compact", (n) => {
        if (typeof n !== "number") return n;
        if (n < 1000) return String(n);
        if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, "") + "K";
        return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    });

    // Bar length as a percentage of the largest value in its chart.
    eleventyConfig.addFilter("pct", (value, max) => (max > 0 ? Math.max(1.5, (value / max) * 100).toFixed(2) : "0"));

    // 4182 -> "4,182". Grouped digits so the footer count stays readable.
    eleventyConfig.addFilter("thousands", (n) =>
        typeof n === "number" ? n.toLocaleString("en-US") : n);

    // Format a guide's `editors` frontmatter (a comma-separated string or a
    // list) into a grammatical English list: "A", "A and B", "A, B, and C".
    // Empty string if there are no editors, so the footer can skip it.
    eleventyConfig.addFilter("formatEditors", (editors) => {
        const names = (Array.isArray(editors) ? editors : String(editors || "").split(","))
            .map((name) => String(name).trim())
            .filter(Boolean);
        if (names.length === 0) return "";
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} and ${names[1]}`;
        return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
    });

    return {
        dir: {
            input: "src", // Read from src
            output: "dist", // Output to dist
            includes: "_includes", // Layout templates
            data: "_data", // Data files
        },
        templateFormats: ["html", "md", "njk"],
        htmlTemplateEngine: "njk", // Use Nunjucks for HTML
        markdownTemplateEngine: "njk",
    };
};
