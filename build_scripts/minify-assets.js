import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { minify as terserMinify } from "terser";
import CleanCSS from "clean-css";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.join(__dirname, "..", "dist");
const BUNDLE = process.env.BUNDLE === "true";

// Core site JS (nav, lightbox, legend, scroll, content, etc.) — loaded `defer`.
const JS_CORE_ORDER = [
    "core/page-utils.js",
    "navigation/scroll-manager.js",
    "ui/legend.js",
    "ui/lightbox.js",
    "content/link-processor.js",
    "content/quick-links.js",
    "content/solver-button-processor.js",
    "quick-links-utils.js",
    "scripts.js",
    "ui/view-counter.js",
    "ui/relative-time.js",
    "ui/line-flagger.js",
    "ui/trending.js",
    "ui/return-pill.js",
];

// Ads — split into its own bundle, loaded `async` and decoupled from core so a
// slow/blocked/failed ad payload never delays core interactivity. ads.js
// self-bootstraps (see ads.ts), so it needs no ordering relative to core.
const JS_ADS_ORDER = ["ui/ads.js"];

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

async function bundleCSS() {
    const stylesPath = path.join(distDir, "css", "styles.css");
    const outPath = path.join(distDir, "css", "bundle.min.css");
    try {
        const output = new CleanCSS({ inline: ["all"] }).minify([stylesPath]);
        if (output.errors.length) throw new Error(output.errors.join(", "));
        fs.writeFileSync(outPath, output.styles, "utf8");
    } catch (error) {
        console.error("❌ Error bundling CSS:", error.message);
    }
}

async function bundleJSFile(order, outName) {
    const outPath = path.join(distDir, "js", outName);
    try {
        const parts = order.map((f) => `(function(){\n${fs.readFileSync(path.join(distDir, "js", f), "utf8")}\n})();`);
        const result = await terserMinify(parts.join("\n"), { compress: true, mangle: true });
        if (!result.code) throw new Error("terser returned no output");
        fs.writeFileSync(outPath, result.code, "utf8");
    } catch (error) {
        console.error(`❌ Error bundling ${outName}:`, error.message);
    }
}

async function bundleJS() {
    await Promise.all([
        bundleJSFile(JS_CORE_ORDER, "bundle.core.min.js"),
        bundleJSFile(JS_ADS_ORDER, "bundle.ads.min.js"),
    ]);
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
    await Promise.all([bundleCSS(), bundleJS()]);
}

// console.log("\n✨ Minification complete!");
