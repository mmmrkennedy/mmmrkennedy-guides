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

// Production assets that pages load individually rather than through the CSS
// bundle, so they need the same content-addressing treatment (see below). Kept explicit
// rather than derived: the point is that adding a page-level <script>/<link>
// without adding it here is a deliberate choice, not an accident.
//   - Solvers.css   — 18 solver/guide pages, gated behind `useSolverCSS`
//   - index-nav, trending  — index, plus index-nav on /solvers behind `useIndexNav` (trending is gated by <body data-trending>)
//   - stats.css     — the stats page only, gated behind `statsPage`
//   - index-filter, birthday — index, plus index-filter on /solvers, so not worth carrying in the core bundle
//   - timezone_conversion   — one guide (shaolin_shuffle)
//   - core, ads — every page, built by build-scripts.mjs
// Deliberately absent: css/styles.css. It is the bundler's input, and the only
// page referencing it directly is the react-solvers dev harness.
const STANDALONE_ASSETS = [
    "css/Solvers.css",
    "css/index-nav.css",
    "css/trending.css",
    "css/stats.css",
    "js/ui/index-filter.js",
    "js/ui/birthday.js",
    "js/timezone_conversion.js",
    "js/core.js",
    "js/ads.js",
];

// Every CSS/JS file a production page references has a hash of its bytes in the
// filename, so two different payloads can never share a URL. A ?v= timestamp can't
// promise that: during deploy propagation an edge can cache old bytes under the new
// value, and _headers then pins that pairing for 30 days.
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
    const assets = [await bundleCSS(), ...STANDALONE_ASSETS.map(hashStandaloneAsset)];
    const hits = rewriteAssetRefs(assets);
    const pruned = pruneStale(assets);

    for (const { hashedUrl, url } of assets) {
        console.log(`${hashedUrl.padEnd(42)} ${hits.get(url)} refs`);
    }
    if (pruned) console.log(`pruned ${pruned} stale hashed asset(s) from a previous build`);
}

// console.log("\n✨ Minification complete!");
