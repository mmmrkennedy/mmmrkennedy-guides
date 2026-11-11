/**
 * One self-contained classic script per entry, so there are no runtime chunks.
 * Filenames are fixed; minify-assets.js adds the content hash for production.
 * Vite only strips types: `tsc -p tsconfig.scripts.json` type-checks, run first
 * by build:scripts.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { build } from "vite";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "js");

// Separate entries: ads loads `async`, the rest are page-specific.
const ENTRIES = {
    "core.js": "src/ts/core.ts",
    "ads.js": "src/ts/ui/ads.ts",
    "ui/index-filter.js": "src/ts/ui/index-filter.ts",
    "ui/birthday.js": "src/ts/ui/birthday.ts",
    "timezone_conversion.js": "src/ts/timezone_conversion.ts",
};

const watch = process.argv.includes("--watch");

// Also clears the hashed copies minify-assets.js renames to.
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
