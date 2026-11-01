/// <reference types="vite/client" />
// Build-time only. vite.ssr.config.js builds this into .solver-ssr/, which
// build_scripts/eleventy/solvers.cjs requires to render each solver's initial HTML straight into
// the page. main.tsx loads the same files on demand; this loads them all up front,
// because Node needs them present synchronously.
//
// EVERY COMPONENT MUST RENDER DETERMINISTICALLY. Same output in Node as in the
// browser on first render, or hydration mismatches. Audited 2026-08-07, and again
// for each solver added since: no Math.random, Date.now, new Date, toLocale, crypto
// or performance.now anywhere, every useState initialiser is a static literal, and
// the only two browser globals used (window.addEventListener in the maze solver,
// document.getElementById in the morse solver) are inside useEffect, which does not
// run during server rendering. Keep it that way.

import type { ComponentType } from "preact";

const modules = import.meta.glob<ComponentType<Record<string, unknown>>>("./components/*.tsx", {
    eager: true,
    import: "default",
});

/* Keys are the filenames, which is what a page's data-solver attribute names. */
export const solvers = Object.fromEntries(
    Object.entries(modules).map(([file, Solver]) => [file.replace(/^.*\/|\.tsx$/g, ""), Solver]),
);
