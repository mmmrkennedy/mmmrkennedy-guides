/// <reference types="vite/client" />
import { hydrate } from "preact";
import type { ComponentType } from "preact";

// Keeps hooks in the entry chunk; as a shared chunk it would only be discovered
// after a solver loads, adding a round trip before first render.
import "preact/hooks";

// Static for the same chunking reason as preact/hooks.
import { SolverReportRoot, readSolverInputs } from "./solver-report";

// One chunk per solver, requested as <div data-solver="<filename>" data-solver-props='{...}'>.
// The filename is also the flag name, so renaming a solver splits its flag history.
// Do NOT statically import a component here: it pulls it back into the entry chunk.
const solvers = import.meta.glob<{ default: ComponentType<Record<string, unknown>> }>("./components/*.tsx");

declare global {
    interface Window {
        /**
         * Bridge to ts/ui/line-flagger.ts, a separate bundle. Optional because
         * most guide pages never load this entry.
         */
        SolverReport?: {
            read: (root: HTMLElement) => { name: string; inputs: Record<string, unknown> } | null;
        };
    }
}

/**
 * hydrate(), not render(): production prerenders the markup (`prerenderSolvers`
 * in build_scripts/eleventy/solvers.cjs). On an empty container it acts like
 * render(), which covers `eleventy --serve` with no SSR build.
 */
function mount(element: HTMLElement) {
    const name = element.dataset.solver;
    const load = solvers[`./components/${name}.tsx`];
    if (!load) {
        console.error("Unknown solver:", name);
        return;
    }
    const props = JSON.parse(element.dataset.solverProps ?? "{}");
    load()
        .then(({ default: Solver }) => {
            // SolverReportRoot renders no DOM, so hydration matches the SSR tree.
            hydrate(
                <SolverReportRoot element={element}>
                    <Solver {...props} />
                </SolverReportRoot>,
                element,
            );
            // line-flagger.ts waits for this before flagging prerendered solvers,
            // since hydration would reconcile away its injected ⚑ nodes.
            document.dispatchEvent(new CustomEvent("solver:hydrated", { detail: { element } }));
        })
        .catch((error) => console.error(`${name}: failed to load solver chunk:`, error));
}

// Assigned here, not in solver-report.tsx, because that module also runs in the
// Node SSR build, where `window` does not exist.
window.SolverReport = { read: readSolverInputs };

// Waits for DOMContentLoaded because line-flagger.ts only starts listening for
// solver:hydrated then, and a chunk that landed first would never get its flags.
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll<HTMLElement>("[data-solver]").forEach(mount);
});

// Dev preview only (src/react-solvers/index.html). Dynamic so its static imports
// of every solver stay out of the entry chunk.
if (document.getElementById("root")) {
    void import("./dev-harness");
}
