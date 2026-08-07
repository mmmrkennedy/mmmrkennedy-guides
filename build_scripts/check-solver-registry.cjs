#!/usr/bin/env node
// Fails the build if the two solver registries disagree.
//
// A solver has to be listed twice, and the duplication is unavoidable:
//
//   src/react-solvers/src/main.tsx      dynamic import() per solver, so Vite can
//                                       emit one browser chunk each
//   src/react-solvers/src/ssr-entry.tsx static imports, so Node can render them
//                                       at build time for prerendering
//
// One needs laziness, the other needs everything present synchronously, so they
// cannot share a loader map. What they CAN share is a guarantee that the set of
// mount names is identical, which is what this checks.
//
// Get it wrong in the direction of "in main.tsx but not ssr-entry" and the solver
// silently stops being prerendered — the page still works, it just quietly loses
// the layout-shift fix. That is exactly the kind of regression nobody notices for
// months, hence a hard build failure rather than a warning.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mainPath = path.join(root, "src/react-solvers/src/main.tsx");
const ssrPath = path.join(root, "src/react-solvers/src/ssr-entry.tsx");

// `mountX: (id, opts) => mount(...)` — anchored on the arrow form so the
// `mountX: MountFunction;` lines in the interface above are skipped.
const MAIN_ENTRY = /(mount[A-Za-z0-9]+)\s*:\s*\(id, opts\)\s*=>/g;
// `mountX: SomeComponent,` inside the exported `solvers` map.
const SSR_ENTRY = /(mount[A-Za-z0-9]+)\s*:\s*[A-Z][A-Za-z0-9]*\s*,/g;

function namesIn(file, pattern) {
    const source = fs.readFileSync(file, "utf8");
    return new Set([...source.matchAll(pattern)].map((m) => m[1]));
}

const inMain = namesIn(mainPath, MAIN_ENTRY);
const inSsr = namesIn(ssrPath, SSR_ENTRY);

const missingFromSsr = [...inMain].filter((n) => !inSsr.has(n));
const missingFromMain = [...inSsr].filter((n) => !inMain.has(n));

if (!inMain.size || !inSsr.size) {
    console.error("check-solver-registry: parsed 0 mount names from one of the registries.");
    console.error(`  main.tsx: ${inMain.size}, ssr-entry.tsx: ${inSsr.size}`);
    console.error("  The regexes above no longer match the source. Fix them, do not delete this check.");
    process.exit(1);
}

if (missingFromSsr.length || missingFromMain.length) {
    console.error("check-solver-registry: the two solver registries disagree.\n");
    for (const n of missingFromSsr) {
        console.error(`  ${n} is in main.tsx but not ssr-entry.tsx — it would not be prerendered.`);
    }
    for (const n of missingFromMain) {
        console.error(`  ${n} is in ssr-entry.tsx but not main.tsx — nothing can mount it.`);
    }
    console.error("\n  Add it to both. See the header of ssr-entry.tsx for why there are two.");
    process.exit(1);
}

console.log(`check-solver-registry: ${inMain.size} solvers, both registries agree.`);
