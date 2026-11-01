/// <reference types="vite/client" />
import { hydrate } from "preact";
import type { ComponentType } from "preact";

// Pulled in for its side effect on chunking, not for anything used here.
//
// Every solver uses hooks. Importing them here keeps them in the entry, instead of
// a shared chunk the browser only discovers after loading a solver, which would add
// a third round trip before first render.
import "preact/hooks";

// Not a solver. Imported statically for the same chunking reason as preact/hooks.
import { SolverReportRoot, readSolverInputs } from "./solver-report";

// Each file in components/ is one solver and one chunk, so a page downloads only
// the ones it uses. A page asks for one by filename:
//
//   <div data-solver="DialSolver"></div>
//   <div data-solver="SimonSaysSolver" data-solver-props='{"colours": ["#e74c3c"]}'></div>
//
// The filename is also the name flags are filed under, so renaming a solver splits
// its flag history. Do NOT statically import a component here: one is enough to
// pull it back into the entry chunk and quietly undo the split for that solver.
const solvers = import.meta.glob<{ default: ComponentType<Record<string, unknown>> }>("./components/*.tsx");

declare global {
    interface Window {
        /**
         * Bridge to ts/ui/line-flagger.ts, which is a classic script in a
         * separate bundle and cannot import from this module graph. Optional on
         * purpose: the flagger runs on every guide page, most of which never load
         * this entry at all.
         */
        SolverReport?: {
            read: (root: HTMLElement) => { name: string; inputs: Record<string, unknown> } | null;
        };
    }
}

/**
 * Fetch a solver's chunk, then attach it to its element.
 *
 * hydrate(), not render(), because the production build already put the solver's
 * markup in the page (`prerenderSolvers` in build_scripts/eleventy/solvers.cjs), so
 * the page doesn't move when a chunk lands. Hydrating an empty container acts like
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
            // SolverReportRoot renders no DOM, so hydration sees exactly the tree
            // the SSR build wrote. It only tells the solver inside which element
            // to publish its inputs against.
            hydrate(
                <SolverReportRoot element={element}>
                    <Solver {...props} />
                </SolverReportRoot>,
                element,
            );
            // ts/ui/line-flagger.ts deliberately skips prerendered solver markup
            // at DOMContentLoaded, because hydrating afterwards would reconcile
            // away every ⚑ it had just injected. This is its cue that the subtree
            // is settled and safe to decorate. Fired per container, so a page with
            // five solvers flags each as it lands.
            document.dispatchEvent(new CustomEvent("solver:hydrated", { detail: { element } }));
        })
        .catch((error) => console.error(`${name}: failed to load solver chunk:`, error));
}

// How line-flagger.ts reaches a mounted solver's inputs. Assigned here rather
// than inside solver-report.tsx because that module is also pulled into the Node
// SSR build, where `window` does not exist.
window.SolverReport = { read: readSolverInputs };

// Waits for DOMContentLoaded because line-flagger.ts only starts listening for
// solver:hydrated then, and a chunk that landed first would never get its flags.
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll<HTMLElement>("[data-solver]").forEach(mount);
});

// Dev preview only (src/react-solvers/index.html), which renders every solver at
// once. Behind its own dynamic import so the static imports it needs land in a
// chunk nobody but that page ever downloads — importing it here directly would
// drag every solver back into the entry.
if (document.getElementById("root")) {
    void import("./dev-harness");
}
