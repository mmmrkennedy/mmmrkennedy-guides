/**
 * Builds the site scripts from src/ts into dist/js.
 *
 * Each entry becomes one self-contained classic script, so pages load it with a
 * plain <script defer> and there are no chunks at runtime to fetch or go missing.
 * Filenames are fixed here. For production, minify-assets.js minifies them and adds
 * the content hash, so dev never has a filename that goes stale under a running server.
 *
 * Vite only strips the types. `tsc -p tsconfig.scripts.json` is what type-checks,
 * and build:scripts runs it first.
 *
 *   node build_scripts/build-scripts.mjs            build once
 *   node build_scripts/build-scripts.mjs --watch    rebuild on change
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "js");

// Output path under /js/ -> source. Everything but core is loaded on its own:
// ads is `async` so it can't delay the page, the rest are specific to a few pages.
const ENTRIES = {
    "core.js": "src/ts/core.ts",
    "ads.js": "src/ts/ui/ads.ts",
    "ui/index-filter.js": "src/ts/ui/index-filter.ts",
    "ui/birthday.js": "src/ts/ui/birthday.ts",
    "timezone_conversion.js": "src/ts/timezone_conversion.ts",
};

const watch = process.argv.includes("--watch");

// Clears earlier builds, including the hashed copies minify-assets.js renames to.
fs.rmSync(outDir, { recursive: true, force: true });

await Promise.all(
    Object.entries(ENTRIES).map(([output, source]) =>
        build({
            configFile: false,
            root,
            publicDir: false,
            logLevel: "warn",
            build: {
                outDir,
                emptyOutDir: false,
                target: "es2020",
                minify: false,
                modulePreload: false,
                watch: watch ? {} : null,
                rollupOptions: {
                    input: path.join(root, source),
                    output: { format: "iife", entryFileNames: output },
                },
            },
        }),
    ),
);
