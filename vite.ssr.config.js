// Node build of the solvers for build-time prerendering by build_scripts/eleventy/solvers.cjs.
//
// Output goes to .solver-ssr/, not dist/: dist/ is deployed, and Pages has a 20,000-file cap.
//
// preact must stay external (Vite's SSR default): render-to-string reaches into
// preact's internals, so two copies render nothing. Don't "fix" it with noExternal.

import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    plugins: [preact()],
    logLevel: "warn",
    build: {
        ssr: path.resolve(__dirname, "src/react-solvers/src/ssr-entry.tsx"),
        outDir: path.resolve(__dirname, ".solver-ssr"),
        // The browser build drops its stamp file here too (see vite.config.js).
        emptyOutDir: false,
        sourcemap: false,
        minify: false,
        rollupOptions: {
            output: {
                // CJS so solvers.cjs can require() it; ESM would make the eleventy transform async.
                format: "cjs",
                entryFileNames: "solvers.cjs",
            },
        },
    },
});
