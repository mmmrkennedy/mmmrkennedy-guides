const fs = require("fs");
const path = require("path");

let cachedManifest = null;
let cachedSsrSolvers;
let ssrWarned = false;

/** Preloaded with the entry so a page with several solvers doesn't shift as each lands. */
function solverChunkHrefs(content, manifest) {
    const hrefs = new Set();
    for (const [, name] of content.matchAll(/\bdata-solver="([^"]+)"/g)) {
        const chunk = manifest[`src/components/${name}.tsx`];
        if (chunk) hrefs.add(`/react-solvers/${chunk.file}`);
        else console.warn(`⚠️  No chunk in the Vite manifest for solver ${name}`);
    }
    return [...hrefs];
}

/**
 * From vite.ssr.config.js. Null when absent (plain `eleventy --serve`): mount divs
 * stay empty and the browser fills them.
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

/** Under `dev:watch` a solver edit changes chunk hashes, so stale caches would point at dead chunks. */
function resetSolverCaches() {
    cachedManifest = null;
    cachedSsrSolvers = undefined;
    try {
        delete require.cache[require.resolve("../../.solver-ssr/solvers.cjs")];
    } catch {
        // No SSR build yet: nothing cached to drop.
    }
}

/**
 * Ships solver markup at its real height so the page doesn't shift; main.tsx hydrates it.
 * A bad name or props fails a production build but only warns in dev, where the
 * SSR build can lag a new solver.
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
        const indexEntry = manifest["index.html"];
        if (!indexEntry || !indexEntry.file) {
            console.error("❌ Could not find index.html entry in Vite manifest");
            return content;
        }

        const bundlePath = `/react-solvers/${indexEntry.file}`;
        let modified = content;

        if (content.includes("<!-- REACT_BUNDLE_MODULEPRELOAD -->")) {
            const hrefs = [bundlePath, ...solverChunkHrefs(content, manifest)];
            const links = hrefs.map((href) => `<link rel="modulepreload" href="${href}" />`).join("");
            modified = modified.replace("<!-- REACT_BUNDLE_MODULEPRELOAD -->", links);
        }

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

module.exports = { injectReactBundle, prerenderSolvers, resetSolverCaches };
