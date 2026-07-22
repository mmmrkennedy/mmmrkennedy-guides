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
    console.warn("lastmod-cache.json not found — footer 'last updated' dates will be omitted.");
}

// Commits-per-file ("edit count"), from the same refresh script as lastmodCache.
let editcountCache = {};
try {
    editcountCache = require("./build_scripts/editcount-cache.json");
} catch {
    console.warn("editcount-cache.json not found — footer edit counts will be omitted.");
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
        // console.log(`[generateQuickLinks] ${outputPath} — ${Date.now() - t0}ms`);
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
        // console.log(`[classifyLinks] ${outputPath} — ${Date.now() - t0}ms`);
        return modified ? final : content;
    } catch (error) {
        console.error(`Error classifying links in ${outputPath}:`, error.message);
        return content;
    }
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

        // console.log(`[addVersioning] ${outputPath} — ${Date.now() - t0}ms`);
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

        // console.log(`[injectReactBundle] ${outputPath} — ${Date.now() - t0}ms`);
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

// ========================================
// SMART IMAGE COPY
// ========================================

// Extensions eligible for the smart asset copy below (not strictly images — also
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
    // thousands of images, not raw throughput — so a worker pool hides that latency
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
    eleventyConfig.addTransform("generateQuickLinks", generateQuickLinks);
    eleventyConfig.addTransform("classifyLinks", classifyLinks);
    eleventyConfig.addTransform("addVersioning", addVersioning);
    eleventyConfig.addTransform("injectReactBundle", injectReactBundle);

    // Performance optimization: use passthrough for dev server (faster)
    eleventyConfig.setServerPassthroughCopyBehavior("passthrough");

    // Smart image copy: only copies new or changed files
    eleventyConfig.on("eleventy.before", smartCopyImages);

    // Passthrough copy static assets (non-image)
    eleventyConfig.addPassthroughCopy("src/css/*");
    eleventyConfig.addPassthroughCopy("src/js");
    eleventyConfig.addPassthroughCopy("src/favicon");
    eleventyConfig.addPassthroughCopy("src/font");
    eleventyConfig.addPassthroughCopy("src/react-solvers");
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

    // Given a page's inputPath (e.g. "./src/index.html"), return its git last-modified
    // date from lastmod-cache.json, formatted like "May 11, 2026". Empty string if unknown.
    eleventyConfig.addFilter("lastmod", (inputPath) => {
        if (!inputPath) return "";
        const key = inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
        const iso = lastmodCache[key];
        if (!iso) return "";
        // Use the calendar date as recorded in the stored offset (the leading
        // YYYY-MM-DD) and format it in UTC, so the build server's timezone (UTC on
        // Cloudflare) can't shift an evening-local date onto the next day.
        const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
        });
    });

    // Given a page's inputPath, return how many commits have touched it (its
    // "edit count") from editcount-cache.json. Null if unknown, so the template
    // can skip rendering rather than show "0 edits".
    eleventyConfig.addFilter("editcount", (inputPath) => {
        if (!inputPath) return null;
        const key = inputPath.replace(/\\/g, "/").replace(/^\.\//, "");
        return editcountCache[key] || null;
    });

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
