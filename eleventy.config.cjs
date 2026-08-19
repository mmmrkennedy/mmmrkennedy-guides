const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

let cachedManifest = null;
let cachedMountChunks = null;
let cachedSsrSolvers;
let ssrWarned = false;

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

// Link targets classifyLinks understands. Anything with an extension outside
// VALID_EXTS is a typo worth warning about; the LIGHTBOX_* sets decide which
// ones open in the lightbox and as what.
const VALID_EXTS = [".webp", ".html", ".webm", ".gif", ".jpg", ".jpeg", ".png", ".mp4", ".mov", ".flac", ".mp3", ".ogg", ".wav", ".m4a"];
const LIGHTBOX_EXTS = new Set([".webp", ".jpg", ".jpeg", ".png", ".gif", ".webm", ".mp4", ".mov", ".flac", ".mp3", ".ogg", ".wav", ".m4a"]);
const LIGHTBOX_VIDEO_EXTS = new Set([".webm", ".mp4", ".mov"]);
const LIGHTBOX_AUDIO_EXTS = new Set([".flac", ".mp3", ".ogg", ".wav", ".m4a"]);

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

    const srcDir = path.join(__dirname, "src");
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

// ========================================
// TRANSFORM FUNCTIONS
// ========================================

/**
 * The DOM-rewriting half of the build, run as a single pass.
 *
 * Each step below used to be its own Eleventy transform, which meant a page was
 * parsed into a JSDOM document and serialized back out up to five times over.
 * Eleventy's own benchmark put those five at 77% of build time, and most of the
 * parses bought nothing: preRenderRevealButtons parsed all 82 pages to serve the
 * 3 that carry a data-reveal-label, and prepareTables parsed all 82 to serve 33.
 * One parse, one serialize, same steps in the same order.
 *
 * A step takes the shared document and returns whether it changed anything. The
 * page is re-serialized only if some step did, so pages no step touches (the
 * index, /stats, 404) come out byte-identical to their input instead of being
 * round-tripped through JSDOM's serializer.
 *
 * Order is load-bearing:
 *   - resolveStepRefs counts the <li> children of each <ol> before
 *     preRenderRevealButtons can re-parent any of them into a
 *     .button-activated-div and change what "direct child" means.
 *   - generateQuickLinks reads the finished page, so it goes last.
 *
 * classifyLinks deliberately runs BEFORE this pass rather than inside it. It is
 * a regex over the HTML string, and the two tables of contents this pass builds
 * are full of anchors it must not touch (they would pick up .link-to-page and
 * render italic). Running it first means those anchors do not exist yet, which
 * is what the 40-line cutElement() surgery used to arrange by hand.
 *
 * A step that throws is logged and skipped; the rest of the pass still runs, so
 * one bad page loses one feature rather than the whole build. Note the step may
 * have mutated the document before throwing, and that partial edit does ship —
 * the alternative is discarding four good steps to undo half of a fifth.
 */
const DOM_STEPS = [
    ["prepareTables", prepareTables],
    ["resolveStepRefs", resolveStepRefs],
    ["preRenderRevealButtons", preRenderRevealButtons],
    ["preRenderPathTabs", preRenderPathTabs],
    ["preRenderIndexNav", preRenderIndexNav],
    ["generateQuickLinks", generateQuickLinks],
];

// Cheap string tests standing in for the selectors the steps run. If a page
// matches none of them, parsing it could only ever find nothing to do.
const DOM_PASS_TRIGGERS = [
    "<table",
    "data-step-ref",
    "data-reveal-label",
    "data-path-group",
    "data-index-nav",
    "content-container",
];

function domPass(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    if (!DOM_PASS_TRIGGERS.some((trigger) => content.includes(trigger))) return content;

    let dom;
    try {
        dom = new JSDOM(content);
    } catch (error) {
        console.error(`Error parsing ${outputPath}:`, error.message);
        return content;
    }

    let touched = false;
    for (const [name, step] of DOM_STEPS) {
        try {
            if (step(dom.window.document, outputPath)) touched = true;
        } catch (error) {
            console.error(`Error in ${name} for ${outputPath}:`, error.message);
        }
    }

    return touched ? dom.serialize() : content;
}

/**
 * Eleventy transform to auto-generate quick links navigation
 * Scans page content and builds table of contents in .quick-links-container
 */
function generateQuickLinks(document) {
    // Skip TOC generation if the page opts out
    if (document.body?.dataset?.skipToc === "true") return false;

    let container = document.querySelector(".quick-links-container");
    if (!container) {
        // Create the container and insert it before the first .content-container
        container = document.createElement("div");
        container.className = "quick-links-container";
        const firstSection = document.querySelector(".content-container");
        if (!firstSection) return false;
        firstSection.parentNode.insertBefore(container, firstSection);
    }

    // Clear existing manual content
    container.innerHTML = "";

    // Build navigation from page structure
    const navStructure = buildNavStructure(document);
    renderNavigation(container, navStructure);
    renderSidebarToc(document, container);

    return true;
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
function renderNavigation(container, structure) {
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
            const link = createNavLink(document, item.element, item.customName);
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
 * Pre-renders the fixed sidebar TOC from the inline one.
 *
 * This used to be cloned client-side at DOMContentLoaded. On a throttled device
 * that landed ~1s after first contentful paint — the guide was fully readable
 * while the sidebar was still missing — because it had to wait for the whole
 * document to parse, then the core bundle, then five earlier init steps.
 * Shipping it in the HTML lets it paint with everything else; quick-links.ts
 * hydrates this markup and keeps its runtime build as a fallback.
 */
function renderSidebarToc(document, tocContainer) {
    document.querySelector(".sidebar-toc")?.remove();
    if (!tocContainer.children.length) return;

    const sidebar = document.createElement("nav");
    sidebar.className = "sidebar-toc";
    sidebar.dataset.prebuilt = "true";
    sidebar.setAttribute("aria-label", "Page contents");

    const header = document.createElement("div");
    header.className = "sidebar-toc-header";

    const label = document.createElement("p");
    label.className = "sidebar-toc-label";
    label.textContent = "Contents";
    header.appendChild(label);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-toc-toggle";
    toggle.setAttribute("aria-label", "Toggle table of contents");
    toggle.textContent = "Hide";
    header.appendChild(toggle);

    sidebar.appendChild(header);

    const body = document.createElement("div");
    body.className = "sidebar-toc-body";
    for (const child of tocContainer.children) {
        body.appendChild(child.cloneNode(true));
    }
    sidebar.appendChild(body);

    addSidebarSubToggles(document, body);

    // Ahead of .content-window so it streams in before the guide body rather
    // than after it. It's position:fixed, so DOM order doesn't affect layout.
    const contentWindow = document.querySelector(".content-window");
    if (contentWindow?.parentNode) {
        contentWindow.parentNode.insertBefore(sidebar, contentWindow);
    } else {
        document.body.appendChild(sidebar);
    }
}

/**
 * Emits the collapse toggle for every sidebar item that has nested children,
 * matching what setupSidebarSubToggles() builds at runtime. Sub-lists ship
 * collapsed; quick-links.ts only has to attach the click handlers.
 */
function addSidebarSubToggles(document, container) {
    for (const li of container.querySelectorAll("li")) {
        const childUl = li.querySelector(":scope > ul");
        if (!childUl) continue;

        childUl.style.display = "none";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar-toc-sub-toggle";
        btn.setAttribute("aria-label", "Toggle sub-items");
        btn.textContent = "▸";

        li.insertBefore(btn, li.firstChild);
    }
}

/**
 * Creates a navigation link element
 */
function createNavLink(document, element, customName = null) {
    if (!element.id) return null;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${element.id}`;

    // Determine link text
    if (customName) {
        a.textContent = customName;
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
    // The solver components' own classes (solver-container, solver-output,
    // solver-symbol-select) are deliberately not here: this transform runs
    // before prerenderSolvers, so a page's solver markup does not exist yet
    // when the nav is built. Adding them back would only take effect if that
    // order changed.
    const excludedClasses = ["stats", "weapon-desc"];

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

    try {
        let modified = false;

        const result = content.replace(/<a(\s[^>]*)>/gi, (match, attrs) => {
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

            // Anything with a scheme, or protocol-relative, plus the bare
            // hostnames ("example.com/foo") authors write without one.
            const isExternal = /^(?:[a-z]+:)?\/\//i.test(href) ||
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
                // A trailing slash means a half-written link (`pictures/foo/`), with
                // one exception: "/" on its own is the site root, which is as
                // complete as a path gets. Without this, a plain "Back to the
                // index" link gets rewritten to href="#" and stops working — which
                // is exactly what happened to the 404 page.
                if (href.endsWith("/") && href !== "/") {
                    existing.add("incomplete-path");
                    overrideHref = "#";
                    console.warn(`Incomplete path in ${outputPath}: ${href}`);
                } else {
                    const pathWithoutQuery = href.split("?")[0];
                    const hasUnknownExt = /\.[a-z0-9]+$/i.test(pathWithoutQuery);
                    const hasKnownExt = VALID_EXTS.some((ext) => pathWithoutQuery.toLowerCase().endsWith(ext));
                    if (hasUnknownExt && !hasKnownExt) {
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

        return modified ? result : content;
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
 * Runs last, so classifyLinks still sees the real href.
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
 * Eleventy transform to inject React bundle references from Vite manifest
 * This replaces the need for post-build scripts to update bundle hashes
 */
/**
 * mountX() -> the chunk file that calling it will fetch.
 *
 * Preloading these alongside the entry is what lets src/react-solvers/src/main.tsx
 * batch its renders without a straggler: the chunks arrive together instead of
 * being discovered one at a time only after the entry has run. Without it the
 * five-solver page shifts by CLS 1.23; with preload plus batching it matches the
 * pre-split build.
 *
 * Worth knowing before "optimising" this away: an earlier version preloaded a
 * separate shared preact-hooks chunk too, and that extra request cost ~150ms of
 * FCP by competing with the render-blocking CSS. Hooks now live in the entry, so
 * this is one request per solver and FCP measured BETTER with it than without.
 *
 * The mount-name -> component mapping is read out of main.tsx rather than
 * duplicated here, so adding a solver cannot leave this table quietly stale.
 * Anchored on the `(id, opts) =>` form to skip the `mountX: MountFunction;`
 * lines in the interface above it, which carry no import to find.
 */
function getMountChunkMap(manifest) {
    if (cachedMountChunks) return cachedMountChunks;
    cachedMountChunks = new Map();
    try {
        const source = fs.readFileSync(path.join(__dirname, "src/react-solvers/src/main.tsx"), "utf8");
        const entries = /(mount[A-Za-z0-9]+)\s*:\s*\(id, opts\)\s*=>[\s\S]*?import\("\.\/components\/([A-Za-z0-9]+)"\)/g;
        for (const [, mountName, component] of source.matchAll(entries)) {
            const chunk = manifest[`src/components/${component}.tsx`];
            if (chunk) cachedMountChunks.set(mountName, chunk.file);
        }
        if (!cachedMountChunks.size) {
            console.warn("⚠️  No solver chunks resolved from main.tsx - skipping solver modulepreloads");
        }
    } catch (error) {
        // Not fatal: without these the solvers still load, just one hop later.
        console.warn("⚠️  Could not build solver chunk map:", error.message);
    }
    return cachedMountChunks;
}


/**
 * Build-time solver prerendering.
 *
 * Loads the Node build of the solvers (.solver-ssr/solvers.cjs, produced by
 * vite.ssr.config.js). Returns null when it is absent, which is the normal case
 * for `eleventy --serve` on its own: no prerendering, mount divs stay empty, the
 * browser fills them exactly as it did before. Never fatal.
 */
function getSsrSolvers() {
    if (cachedSsrSolvers !== undefined) return cachedSsrSolvers;
    try {
        const mod = require("./.solver-ssr/solvers.cjs");
        const { render } = require("preact-render-to-string");
        const { h } = require("preact");
        cachedSsrSolvers = { solvers: mod.solvers, render, h };
    } catch {
        cachedSsrSolvers = null;
        if (!ssrWarned) {
            ssrWarned = true;
            console.warn("\u2139\ufe0f  No .solver-ssr build found - solvers will render client-side (run `bun run build:ssr`).");
        }
    }
    return cachedSsrSolvers;
}

/* Only these two ever appear in a mount call. Anything else and we decline to
   prerender rather than guess, because a prop the build cannot see is a prop the
   client will render differently - which is a hydration mismatch, not a missing
   optimisation. */
const SOLVER_PROP_KEYS = new Set(["title", "keySelectId"]);

/**
 * Parse the options object out of a mountX("id", { ... }) call.
 * Returns null if it contains anything that is not a plain string literal.
 */
function parseSolverProps(raw) {
    if (!raw || !raw.trim()) return {};
    const props = {};
    const body = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
    if (!body.trim()) return {};
    for (const part of body.split(",")) {
        if (!part.trim()) continue;
        const m = /^\s*([A-Za-z0-9_]+)\s*:\s*"([^"]*)"\s*$/.exec(part);
        if (!m || !SOLVER_PROP_KEYS.has(m[1])) return null;
        props[m[1]] = m[2];
    }
    return props;
}

/**
 * Render each solver a page mounts into its own div, so the markup ships in the
 * HTML instead of being created by JavaScript several hundred ms after first
 * paint.
 *
 * That gap was worth CLS 1.23 on the five-solver page against 0.000 before the
 * solvers were split, because five empty divs each grew 0 -> ~550px at different
 * moments. Reserving heights in CSS would have meant 57 measured pixel values
 * that rot; this puts the real content there at its real height instead, and
 * pays for itself again in LCP on pages where the solver IS the largest element.
 *
 * Authoring does not change: pages keep an empty <div id="..."> and a
 * mountX() call, and main.tsx hydrates whatever it finds. Every step here is
 * fail-safe - unparseable props, an unknown mount name, a component that throws,
 * a missing SSR build - and each one just leaves that div empty for the client,
 * which is precisely the old behaviour.
 */
function prerenderSolvers(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (!content.includes("ZombiesSolvers.mount")) return content;

    const ssr = getSsrSolvers();
    if (!ssr) return content;

    let modified = content;

    const calls = /ZombiesSolvers\.(mount[A-Za-z0-9]+)\s*\(\s*"([^"]+)"\s*(?:,\s*(\{[^}]*\}))?\s*\)/g;
    for (const [, mountName, elementId, rawProps] of content.matchAll(calls)) {
        const Solver = ssr.solvers[mountName];
        if (!Solver) {
            console.warn(`prerenderSolvers: ${mountName} not in the SSR registry (${outputPath})`);
            continue;
        }

        const props = parseSolverProps(rawProps);
        if (props === null) {
            console.warn(`prerenderSolvers: ${mountName} has props the build cannot read, skipping (${outputPath})`);
            continue;
        }

        let html;
        try {
            html = ssr.render(ssr.h(Solver, props));
        } catch (error) {
            console.warn(`prerenderSolvers: ${mountName} threw while rendering, skipping (${outputPath}):`, error.message);
            continue;
        }

        // Match the div by id and fill it only if it is genuinely empty, so a
        // second pass can never nest one render inside another.
        const escaped = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const target = new RegExp(`(<div[^>]*\\bid="${escaped}"[^>]*>)\\s*(</div>)`);
        if (!target.test(modified)) {
            console.warn(`prerenderSolvers: no empty <div id="${elementId}"> to fill (${outputPath})`);
            continue;
        }
        // data-solver-root marks the subtree as "Preact is about to hydrate this".
        // ts/ui/line-flagger.ts skips it at DOMContentLoaded and waits for the
        // solver:hydrated event instead — decorating it now would mean hydration
        // reconciling away every ⚑ button a moment later.
        //
        // An attribute rather than the [id$="-react"] naming convention the mount
        // divs happen to share: that convention lives in 19 hand-written templates
        // and would fail silently the first time someone names one differently.
        modified = modified.replace(target, (_m, open, close) => {
            const marked = open.includes("data-solver-root") ? open : open.replace(/>$/, " data-solver-root>");
            return marked + html + close;
        });
    }

    return modified;
}

function injectReactBundle(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    // Only process files that need React bundle injection
    if (
        !content.includes("<!-- REACT_BUNDLE_PLACEHOLDER -->") &&
        !content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")
    ) {
        return content;
    }

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

        // Handle modulepreload links: the entry, then the chunk for every solver
        // this page mounts, so they all fetch in parallel instead of the page
        // waiting for the entry to run before it learns what else it needs.
        if (content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")) {
            const hrefs = [bundlePath];
            const mountChunks = getMountChunkMap(manifest);
            const called = new Set();
            for (const [, name] of content.matchAll(/ZombiesSolvers\.(mount[A-Za-z0-9]+)\s*\(/g)) {
                called.add(name);
            }
            for (const name of called) {
                const file = mountChunks.get(name);
                if (!file) continue;
                const href = `/react-solvers/${file}`;
                if (!hrefs.includes(href)) hrefs.push(href);
            }
            const links = hrefs.map((href) => `<link rel="modulepreload" href="${href}" />`).join("");
            modified = modified.replace("<!-- REACT_BUNDLE_MODULEPRELOAD -->", links);
        }

        // Handle script tag
        if (content.includes("<!-- REACT_BUNDLE_PLACEHOLDER -->")) {
            const scriptTag = `<script type="module" src="${bundlePath}"></script>`;
            modified = modified.replace("<!-- REACT_BUNDLE_PLACEHOLDER -->", scriptTag);
        }

        return modified;
    } catch (error) {
        console.error(`❌ Error injecting React bundle in ${outputPath}:`, error.message);
        return content;
    }
}

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
 *   - [data-sortable]. table-sort.ts puts its controls in the header row, and
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

function preRenderRevealButtons(document) {
    const elements = document.querySelectorAll("[data-reveal-label]");
    if (!elements.length) return false;

    for (const el of elements) {
        const label = el.getAttribute("data-reveal-label");
        const inner = el.innerHTML;
        el.innerHTML = `<button type="button" class="btn--reveal">${label}</button>
<div class="button-activated-div" style="display: none;">${inner}</div>`;
    }
    return true;
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

function preRenderPathTabs(document, outputPath) {
    const groups = document.querySelectorAll("[data-path-group]");
    if (!groups.length) return false;

    let modified = false;

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
        modified = true;

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
            // A panel that already carries an id keeps it — guides deep-link to
            // these sections by name. aria-controls has to name whatever id the
            // panel ends up with, not the one generated here: pointing it at an
            // id nothing has is an invalid ARIA reference, which is what
            // Lighthouse caught on attack_of_the_radioactive_thing.
            if (!path.id) path.id = panelId;
            tab.setAttribute("aria-controls", path.id);
            if (!isDefault) path.setAttribute("hidden", "");
            path.removeAttribute("data-path-label");
            path.removeAttribute("data-path-note");
            path.removeAttribute("data-path-default");
            panels.appendChild(path);
        });

        group.prepend(bar);
        bar.after(panels);
    }

    return modified;
}

/**
 * Walks every <ol> on the page and records the number each named step renders
 * as, mirroring how the browser counts:
 *
 *  - only <li> that are *direct* children of the <ol> count, so the nested <ul>
 *    of picture links inside a step can't shift the numbering;
 *  - `.dummy-li` is skipped, because typography.css zeroes its counter-increment
 *    (those are the section headings sitting inside the list);
 *  - `start` on the <ol> and `value` on an <li> are honoured, same as the spec.
 */
function collectStepNumbers(document, outputPath) {
    const numbers = new Map();

    for (const list of document.querySelectorAll("ol")) {
        let n = Number(list.getAttribute("start")) || 1;

        for (const item of list.children) {
            if (item.tagName !== "LI") continue;
            if (item.classList.contains("dummy-li")) continue;

            const explicit = Number(item.getAttribute("value"));
            if (explicit) n = explicit;

            const name = item.getAttribute("data-step-id");
            if (name) {
                if (numbers.has(name)) {
                    console.warn(
                        `[resolveStepRefs] duplicate data-step-id "${name}" in ${outputPath}; using step ${n}.`,
                    );
                }
                numbers.set(name, n);
            }

            n += 1;
        }
    }

    return numbers;
}

/**
 * Resolves symbolic step references to the number the step actually renders as,
 * so a hand-written "Repeat Steps 11-13" can't desync when a step is inserted
 * above it.
 *
 * Authored form — the step being pointed at gets a name, and the reference
 * carries that name instead of a number:
 *
 *   <li data-step-id="charge-canister">Insert the canister into the harvester…</li>
 *   <li data-step-id="deposit-canister">Bring the filled canister…</li>
 *   <li><i>Repeat Steps <span data-step-ref="charge-canister"
 *          data-step-ref-to="deposit-canister"></span> for the other two.</i></li>
 *
 * renders as "Repeat Steps 11-13 for the other two." Drop `data-step-ref-to`
 * for a single step. The <span> is replaced by the text outright, so nothing
 * about it survives into the output.
 *
 * Ranges join with "-"; guides that were written with an en dash keep it via
 * `data-step-ref-sep="–"`.
 *
 * Names are page-scoped: a reference resolves only against steps in the same
 * file. An unresolved name warns and renders as the name itself, which is ugly
 * on purpose — it surfaces in the dev preview instead of shipping a silent "?".
 */
function resolveStepRefs(document, outputPath) {
    const refs = document.querySelectorAll("[data-step-ref]");
    if (!refs.length) return false;

    const numbers = collectStepNumbers(document, outputPath);

    for (const ref of refs) {
        const from = ref.getAttribute("data-step-ref");
        const to = ref.getAttribute("data-step-ref-to");

        for (const [attr, name] of [["data-step-ref", from], ["data-step-ref-to", to]]) {
            if (name && !numbers.has(name)) {
                console.warn(
                    `[resolveStepRefs] ${attr}="${name}" in ${outputPath} matches no data-step-id.`,
                );
            }
        }

        const start = numbers.get(from);
        const end = to ? numbers.get(to) : start;
        const sep = ref.getAttribute("data-step-ref-sep") || "-";

        let text;
        if (start === undefined || end === undefined) {
            text = to ? `${from}${sep}${to}` : from;
        } else if (end < start) {
            console.warn(
                `[resolveStepRefs] range "${from}"→"${to}" in ${outputPath} runs backwards (${start}${sep}${end}).`,
            );
            text = `${start}${sep}${end}`;
        } else {
            text = start === end ? `${start}` : `${start}${sep}${end}`;
        }

        ref.replaceWith(document.createTextNode(text));
    }

    return true;
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

// Images live in R2 and are served by functions/games/[[path]].js, so a
// production build has no reason to carry 4,555 of them into the deployment.
// Opt-in via IMAGES_FROM_R2=true (set alongside BUNDLE=true in `bun run build`)
// rather than on by default, so `eleventy --serve` keeps copying them and local
// dev works from disk with no bucket, no binding and no network.
//
// Only the image formats actually uploaded are skipped. The handful of .webm
// and .wav files under src/games stay in the deployment — 19MB total, and
// keeping them out of R2 keeps the Function's route check purely image-based.
const R2_SERVED = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

async function smartCopyImages() {
    const skipImages = process.env.IMAGES_FROM_R2 === "true";

    const pairs = [
        // src/games/**/* → dist/games/**/
        ...walkDir("src/games")
            .filter((src) => !(skipImages && R2_SERVED.has(path.extname(src).toLowerCase())))
            .map((src) => ({
                src,
                dest: path.join("dist", path.relative("src", src)),
            })),
        // src root-level assets → dist/. Never skipped: og_image.png and the
        // favicon are referenced by absolute URL in meta tags and by crawlers
        // that will not be going through the images Function.
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
    // classifyLinks first: it must not see the tables of contents domPass builds.
    eleventyConfig.addTransform("classifyLinks", classifyLinks);
    eleventyConfig.addTransform("domPass", domPass);
    eleventyConfig.addTransform("injectReactBundle", injectReactBundle);
    eleventyConfig.addTransform("prerenderSolvers", prerenderSolvers);
    eleventyConfig.addTransform("unlinkUnwrittenGuides", unlinkUnwrittenGuides);

    // Performance optimization: use passthrough for dev server (faster)
    eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

    // Smart image copy: only copies new or changed files
    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Re-measure every build. Without this the cache is filled once and never
    // again, so under `eleventy --serve` the stats page and the index footer
    // freeze at whatever the numbers were when the server started.
    eleventyConfig.on("eleventy.before", () => { statsCache = null; });

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
