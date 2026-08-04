import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { minify as terserMinify } from "terser";
import CleanCSS from "clean-css";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, "..", "dist");
const BUNDLE = process.env.BUNDLE === "true";

// Core site JS (nav, lightbox, legend, scroll, content, etc.), loaded `defer`.
const JS_CORE_ORDER = [
    // First: defines window.Log, which any script below may call.
    "core/logger.js",
    "core/page-utils.js",
    "navigation/scroll-manager.js",
    "ui/legend.js",
    "ui/lightbox.js",
    "content/link-processor.js",
    "content/quick-links.js",
    "content/solver-button-processor.js",
    "content/path-tabs.js",
    "quick-links-utils.js",
    "scripts.js",
    "ui/view-counter.js",
    "ui/relative-time.js",
    "ui/line-flagger.js",
    "ui/trending.js",
    "ui/stats-live.js",
    "ui/table-sort.js",
    "ui/return-pill.js",
];

// Ads, split into its own bundle, loaded `async` and decoupled from core so a
// slow/blocked/failed ad payload never delays core interactivity. ads.js
// self-bootstraps (see ads.ts), so it needs no ordering relative to core.
const JS_ADS_ORDER = ["ui/ads.js"];

// Production assets that pages load individually rather than through a bundle,
// so they need the same content-addressing treatment (see below). Kept explicit
// rather than derived: the point is that adding a page-level <script>/<link>
// without adding it here is a deliberate choice, not an accident.
//   - Solvers.css   — 18 solver/guide pages, gated behind `useSolverCSS`
//   - index-filter, birthday — index-only, so not worth carrying in the core bundle
//   - timezone_conversion   — one guide (shaolin_shuffle)
// Deliberately absent: css/styles.css. It is the bundler's input, and the only
// page referencing it directly is the react-solvers dev harness.
const STANDALONE_ASSETS = [
    "css/Solvers.css",
    "js/ui/index-filter.js",
    "js/ui/birthday.js",
    "js/timezone_conversion.js",
];

// Every CSS/JS file a production page references is content-addressed: the hash
// of the bytes goes into the filename, so two different payloads can never share
// a URL.
//
// This replaces `bundle.min.css?v=<build timestamp>`, which minted a fresh URL
// each build but kept the path constant. On 2026-07-29 that let a bad edge entry
// stick: a request landing during deploy propagation was answered with the
// *previous* deployment's bytes under the *new* ?v= value, and /*.css in
// _headers pinned that pairing for its full 30-day max-age. Readers got new HTML
// with month-old CSS while the origin file was correct the whole time, so
// nothing in the build log hinted at it.
//
// With the hash in the name that cannot recur: changed content means a filename
// no cache has ever seen, so there is no entry left to go stale.
const HASH_LEN = 8;

function contentHash(code) {
    return crypto.createHash("sha256").update(code).digest("hex").slice(0, HASH_LEN);
}

// bundle.min.css -> bundle.<hash>.min.css   (keeps the .min. marker last)
// Solvers.css    -> Solvers.<hash>.css
function hashedName(name, hash) {
    if (/\.min\.(css|js)$/.test(name)) return name.replace(/\.min\.(css|js)$/, `.${hash}.min.$1`);
    return name.replace(/\.([^.]+)$/, `.${hash}.$1`);
}

// Matches any build's hashed variant of `name`, for pruning. Splits the name the
// same way hashedName does — keep the two in step if either changes.
function stalePattern(name) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hash = `[0-9a-f]{${HASH_LEN}}`;

    const min = name.match(/^(.*)\.min\.(css|js)$/);
    if (min) return new RegExp(`^${escape(min[1])}\\.${hash}\\.min\\.${min[2]}$`);

    const [, base, ext] = name.match(/^(.*)\.([^.]+)$/);
    return new RegExp(`^${escape(base)}\\.${hash}\\.${escape(ext)}$`);
}

/**
 * Rename an already-minified passthrough asset to its content-addressed name.
 * Moves rather than copies: the plain path must stop resolving, otherwise a
 * missed reference would keep silently working against the un-versioned URL.
 */
function hashStandaloneAsset(relPath) {
    const absPath = path.join(distDir, relPath);
    if (!fs.existsSync(absPath)) throw new Error(`standalone asset missing from dist: ${relPath}`);

    const name = hashedName(path.basename(relPath), contentHash(fs.readFileSync(absPath)));
    const relDir = path.dirname(relPath);
    fs.renameSync(absPath, path.join(distDir, relDir, name));

    return { url: `/${relPath}`, hashedUrl: `/${relDir}/${name}`, dir: relDir, name };
}

function findHtmlFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findHtmlFiles(full).forEach((f) => files.push(f));
        else if (entry.isFile() && entry.name.endsWith(".html")) files.push(full);
    }
    return files;
}

function findFiles(dir, extensions) {
    const files = [];

    function traverse(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "react-solvers") continue;
                traverse(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (extensions.includes(ext) && !entry.name.endsWith(".min.css") && !entry.name.endsWith(".min.js")) {
                    files.push(fullPath);
                }
            }
        }
    }

    traverse(dir);
    return files;
}

async function minifyCSS(filePath) {
    try {
        const output = new CleanCSS({}).minify([filePath]);
        if (output.errors.length) throw new Error(output.errors.join(", "));
        fs.writeFileSync(filePath, output.styles, "utf8");
        // console.log(`✅ CSS: ${path.relative(distDir, filePath)}`);
    } catch (error) {
        console.error(`❌ Error minifying ${filePath}:`, error.message);
    }
}

async function minifyJS(filePath) {
    try {
        const input = fs.readFileSync(filePath, "utf8");
        const result = await terserMinify(input, { compress: true, mangle: true });
        if (!result.code) throw new Error("terser returned no output");
        fs.writeFileSync(filePath, result.code, "utf8");
        // console.log(`✅ JS:  ${path.relative(distDir, filePath)}`);
    } catch (error) {
        console.error(`❌ Error minifying ${filePath}:`, error.message);
    }
}

// Bundle failures are fatal, unlike the per-file minify errors above. Those
// leave a valid unminified file in place; a missing bundle would leave every
// page pointing at a hashed filename that was never written — an entirely
// unstyled, scriptless site. Better to fail the deploy than ship that.
async function bundleCSS() {
    const stylesPath = path.join(distDir, "css", "styles.css");
    const output = new CleanCSS({ inline: ["all"] }).minify([stylesPath]);
    if (output.errors.length) throw new Error(`bundling CSS: ${output.errors.join(", ")}`);

    return writeBundle("css", "bundle.min.css", output.styles);
}

async function bundleJSFile(order, plainName) {
    const parts = order.map((f) => `(function(){\n${fs.readFileSync(path.join(distDir, "js", f), "utf8")}\n})();`);
    const result = await terserMinify(parts.join("\n"), { compress: true, mangle: true });
    if (!result.code) throw new Error(`bundling ${plainName}: terser returned no output`);

    return writeBundle("js", plainName, result.code);
}

// Shared shape with hashStandaloneAsset, so rewriteAssetRefs treats bundles and
// individually-loaded files identically.
function writeBundle(dir, plainName, code) {
    const name = hashedName(plainName, contentHash(code));
    fs.writeFileSync(path.join(distDir, dir, name), code, "utf8");
    return { url: `/${dir}/${plainName}`, hashedUrl: `/${dir}/${name}`, dir, name };
}

/**
 * Point every built page at the content-addressed filenames.
 *
 * Eleventy runs before the bundles exist, so the templates cannot know the hash;
 * they emit the plain name with the build-timestamp query instead
 * (`/css/bundle.min.css?v=1785364583206`). Both the name and the query — now
 * redundant, since the hash *is* the version — are rewritten here. Runs before
 * minify-html.js, which leaves href/src values alone.
 */
function rewriteAssetRefs(assets) {
    const hits = new Map(assets.map((a) => [a.url, 0]));

    for (const file of findHtmlFiles(distDir)) {
        const input = fs.readFileSync(file, "utf8");
        let output = input;

        for (const { url, hashedUrl } of assets) {
            // The optional query covers both the templates' `?v={{ buildVersion }}`
            // and the hardcoded literal in react-solvers/index.html. Anchored on a
            // quote so /js/ui/index-filter.js cannot match a longer sibling path.
            const ref = new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?v=[0-9]+)?(?=["'])`, "g");
            output = output.replace(ref, () => {
                hits.set(url, hits.get(url) + 1);
                return hashedUrl;
            });
        }

        if (output !== input) fs.writeFileSync(file, output, "utf8");
    }

    // An asset nothing references means the templates drifted, or Eleventy ran
    // without BUNDLE=true and emitted the unbundled per-file tags. Either way the
    // pages are not using what we just built, and for standalone assets the
    // original has already been renamed away — so fail loudly rather than deploy
    // pages pointing at URLs that 404.
    const orphans = [...hits].filter(([, count]) => count === 0).map(([url]) => url);
    if (orphans.length) throw new Error(`no page references ${orphans.join(", ")} — templates and bundler are out of sync`);

    return hits;
}

// Hashed files from earlier builds, left behind because `bun run build` does not
// clean dist. Serving them is harmless, but one set accumulates per build.
function pruneStale(assets) {
    let removed = 0;

    for (const { dir, name } of assets) {
        const full = path.join(distDir, dir);
        if (!fs.existsSync(full)) continue;

        // Reconstruct the plain name from the hashed one to build the pattern.
        const pattern = stalePattern(name.replace(new RegExp(`\\.[0-9a-f]{${HASH_LEN}}\\.`), "."));
        for (const entry of fs.readdirSync(full)) {
            if (pattern.test(entry) && entry !== name) {
                fs.unlinkSync(path.join(full, entry));
                removed++;
            }
        }
    }

    return removed;
}

// console.log("🚀 Starting asset minification...\n");

if (!fs.existsSync(distDir)) {
    console.error("❌ dist directory not found. Run build first.");
    process.exit(1);
}

const cssFiles = findFiles(distDir, [".css"]);
const jsFiles = findFiles(distDir, [".js"]);

// console.log(`Found ${cssFiles.length} CSS files and ${jsFiles.length} JS files\n`);

await Promise.all([
    ...cssFiles.map(minifyCSS),
    ...jsFiles.map(minifyJS),
]);

if (BUNDLE) {
    // Order matters: bundling reads the per-file JS out of dist/js, so the
    // standalone renames have to come after. (None of STANDALONE_ASSETS is in a
    // bundle today, but the ordering keeps that from becoming a trap.)
    const bundles = await Promise.all([
        bundleCSS(),
        bundleJSFile(JS_CORE_ORDER, "bundle.core.min.js"),
        bundleJSFile(JS_ADS_ORDER, "bundle.ads.min.js"),
    ]);

    const assets = [...bundles, ...STANDALONE_ASSETS.map(hashStandaloneAsset)];
    const hits = rewriteAssetRefs(assets);
    const pruned = pruneStale(assets);

    for (const { hashedUrl, url } of assets) {
        console.log(`${hashedUrl.padEnd(42)} ${hits.get(url)} refs`);
    }
    if (pruned) console.log(`pruned ${pruned} stale hashed asset(s) from a previous build`);
}

// console.log("\n✨ Minification complete!");
