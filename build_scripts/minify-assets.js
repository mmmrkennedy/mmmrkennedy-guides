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

// Assets pages load individually, outside the CSS bundle. Explicit on purpose: a
// new page-level <script>/<link> must be added here. css/styles.css is absent
// because it is the bundler's input.
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

// Content hashes, not ?v= timestamps: during deploy propagation an edge can cache
// old bytes under a new ?v=, and _headers then pins that pairing for 30 days.
const HASH_LEN = 8;

function contentHash(code) {
    return crypto.createHash("sha256").update(code).digest("hex").slice(0, HASH_LEN);
}

function hashedName(name, hash) {
    if (/\.min\.(css|js)$/.test(name)) return name.replace(/\.min\.(css|js)$/, `.${hash}.min.$1`);
    return name.replace(/\.([^.]+)$/, `.${hash}.$1`);
}

// Must split names the same way hashedName does.
function stalePattern(name) {
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hash = `[0-9a-f]{${HASH_LEN}}`;

    const min = name.match(/^(.*)\.min\.(css|js)$/);
    if (min) return new RegExp(`^${escape(min[1])}\\.${hash}\\.min\\.${min[2]}$`);

    const [, base, ext] = name.match(/^(.*)\.([^.]+)$/);
    return new RegExp(`^${escape(base)}\\.${hash}\\.${escape(ext)}$`);
}

/**
 * Moves rather than copies, so a missed reference breaks instead of silently
 * using the unversioned URL.
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
    } catch (error) {
        console.error(`❌ Error minifying ${filePath}:`, error.message);
    }
}

// Fatal, unlike per-file minify errors (which leave a valid unminified file): a
// missing bundle leaves every page pointing at a file that was never written.
async function bundleCSS() {
    const stylesPath = path.join(distDir, "css", "styles.css");
    const output = new CleanCSS({ inline: ["all"] }).minify([stylesPath]);
    if (output.errors.length) throw new Error(`bundling CSS: ${output.errors.join(", ")}`);

    return writeBundle("css", "bundle.min.css", output.styles);
}

// Same return shape as hashStandaloneAsset.
function writeBundle(dir, plainName, code) {
    const name = hashedName(plainName, contentHash(code));
    fs.writeFileSync(path.join(distDir, dir, name), code, "utf8");
    return { url: `/${dir}/${plainName}`, hashedUrl: `/${dir}/${name}`, dir, name };
}

/**
 * Eleventy runs before the bundles exist, so templates emit the plain name plus
 * ?v=<timestamp>; both are replaced here. Runs before minify-html.js.
 */
function rewriteAssetRefs(assets) {
    const hits = new Map(assets.map((a) => [a.url, 0]));

    for (const file of findHtmlFiles(distDir)) {
        const input = fs.readFileSync(file, "utf8");
        let output = input;

        for (const { url, hashedUrl } of assets) {
            // The query covers `?v={{ buildVersion }}` and the literal in
            // react-solvers/index.html. The quote lookahead stops longer sibling paths matching.
            const ref = new RegExp(`${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?v=[0-9]+)?(?=["'])`, "g");
            output = output.replace(ref, () => {
                hits.set(url, hits.get(url) + 1);
                return hashedUrl;
            });
        }

        if (output !== input) fs.writeFileSync(file, output, "utf8");
    }

    // Templates drifted, or Eleventy ran without BUNDLE=true. Standalone originals
    // are already renamed away, so deploying would ship 404s.
    const orphans = [...hits].filter(([, count]) => count === 0).map(([url]) => url);
    if (orphans.length) throw new Error(`no page references ${orphans.join(", ")} — templates and bundler are out of sync`);

    return hits;
}

// `bun run build` does not clean dist, so hashed files pile up per build.
function pruneStale(assets) {
    let removed = 0;

    for (const { dir, name } of assets) {
        const full = path.join(distDir, dir);
        if (!fs.existsSync(full)) continue;

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

if (!fs.existsSync(distDir)) {
    console.error("❌ dist directory not found. Run build first.");
    process.exit(1);
}

const cssFiles = findFiles(distDir, [".css"]);
const jsFiles = findFiles(distDir, [".js"]);

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
