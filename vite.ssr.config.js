// Second Vite build, for build-time solver prerendering only.
//
// vite.config.js builds the BROWSER bundle: an entry plus one dynamically
// imported chunk per solver. This one builds the same components for NODE, so
// eleventy.config.cjs can render each solver's initial HTML straight into the
// page and the browser gets markup instead of an empty div to fill in.
//
// Two deliberate choices worth not undoing:
//
// Output lands in .solver-ssr/ at the repo root, NOT under dist/. Anything in
// dist/ is deployed, and this is build machinery that would only add files to a
// Pages deployment that already watches a 20,000-file cap.
//
// preact stays EXTERNAL rather than bundled. eleventy requires
// preact-render-to-string separately, and that only works if both resolve the
// same node_modules/preact — render-to-string reaches into preact's internals,
// so two copies render nothing. Vite externalises dependencies in SSR builds by
// default; this comment exists so nobody "fixes" it with noExternal.

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
        emptyOutDir: true,
        sourcemap: false,
        minify: false,
        rollupOptions: {
            output: {
                // CJS so eleventy.config.cjs can require() it directly. An ESM
                // output would force a dynamic import and make the eleventy
                // transform async for no gain.
                format: "cjs",
                entryFileNames: "solvers.cjs",
            },
        },
    },
});
