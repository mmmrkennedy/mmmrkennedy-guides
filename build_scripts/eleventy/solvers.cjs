const fs = require("fs");
const path = require("path");

let cachedManifest = null;
let cachedSsrSolvers;
let ssrWarned = false;

/**
 * The chunk file of every solver on a page.
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
 */
function solverChunkHrefs(content, manifest) {
    const hrefs = new Set();
    for (const [, name] of content.matchAll(/\bdata-solver="([^"]+)"/g)) {
        const chunk = manifest[`src/components/${name}.tsx`];
        // Not fatal: without the hint the solver still loads, just one hop later.
        if (chunk) hrefs.add(`/react-solvers/${chunk.file}`);
        else console.warn(`⚠️  No chunk in the Vite manifest for solver ${name}`);
    }
    return [...hrefs];
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
        const mod = require("../../.solver-ssr/solvers.cjs");
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

/**
 * Render each solver a page uses into its own div, so the markup ships in the
 * HTML instead of being created by JavaScript several hundred ms after first
 * paint.
 *
 * That gap was worth CLS 1.23 on the five-solver page against 0.000 before the
 * solvers were split, because five empty divs each grew 0 -> ~550px at different
 * moments. Reserving heights in CSS would have meant 57 measured pixel values
 * that rot; this puts the real content there at its real height instead, and
 * pays for itself again in LCP on pages where the solver IS the largest element.
 *
 * Authoring does not change: pages keep an empty <div data-solver="..."> and
 * main.tsx hydrates whatever it finds. Without an SSR build, or if a solver
 * throws, that div stays empty for the client to fill. A name or props the build
 * cannot read would also break in the browser, so those fail a production build
 * and only warn in dev, where the SSR build can briefly lag a new solver.
 */
function prerenderSolvers(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;
    if (!content.includes("data-solver=")) return content;

    const ssr = getSsrSolvers();
    if (!ssr) return content;

    const problem = (message) => {
        if (process.env.BUNDLE === "true") throw new Error(`prerenderSolvers: ${message} (${outputPath})`);
        console.warn(`prerenderSolvers: ${message} (${outputPath})`);
    };

    // Empty divs only, so a second pass can never nest one render inside another.
    return content.replace(/(<div\b[^>]*\bdata-solver="([^"]+)"[^>]*>)\s*(<\/div>)/g, (whole, open, name, close) => {
        const Solver = ssr.solvers[name];
        if (!Solver) {
            problem(`no solver file named ${name}`);
            return whole;
        }

        // domPass may have reserialized the attribute with double quotes.
        const attr = open.match(/\bdata-solver-props=(?:"([^"]*)"|'([^']*)')/);
        let props = {};
        try {
            if (attr) props = JSON.parse((attr[1] ?? attr[2]).replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
        } catch (error) {
            problem(`${name} has invalid data-solver-props: ${error.message}`);
            return whole;
        }

        try {
            return open + ssr.render(ssr.h(Solver, props)) + close;
        } catch (error) {
            console.warn(`prerenderSolvers: ${name} threw while rendering, skipping (${outputPath}):`, error.message);
            return whole;
        }
    });
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
            const manifestPath = path.join(__dirname, "../../dist/react-solvers/.vite/manifest.json");
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
        // this page uses, so they all fetch in parallel instead of the page
        // waiting for the entry to run before it learns what else it needs.
        if (content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")) {
            const hrefs = [bundlePath, ...solverChunkHrefs(content, manifest)];
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

module.exports = { injectReactBundle, prerenderSolvers };
