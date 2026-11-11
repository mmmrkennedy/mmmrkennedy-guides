/// <reference types="vite/client" />
// Build-time only: build_scripts/eleventy/solvers.cjs requires the .solver-ssr/
// output to prerender each solver. Eager because Node needs modules synchronously.
//
// Every component must render deterministically or hydration mismatches: no
// Math.random, Date, toLocale, crypto or performance.now, static useState
// initialisers, and browser globals only inside useEffect.

import type { ComponentType } from "preact";

const modules = import.meta.glob<ComponentType<Record<string, unknown>>>("./components/*.tsx", {
    eager: true,
    import: "default",
});

/* Keys are the filenames, which a page's data-solver attribute names. */
export const solvers = Object.fromEntries(
    Object.entries(modules).map(([file, Solver]) => [file.replace(/^.*\/|\.tsx$/g, ""), Solver]),
);
