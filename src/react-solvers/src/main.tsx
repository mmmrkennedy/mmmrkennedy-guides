/// <reference types="vite/client" />
import { hydrate } from "preact";
import type { ComponentType } from "preact";

// Pulled in for its side effect on chunking, not for anything used here.
//
// Every solver uses preact hooks, but nothing in the entry did, so Rollup hoisted
// them into a chunk shared between the dynamic chunks — which the browser cannot
// discover until it has downloaded AND parsed a solver chunk. That made three
// serial round trips to first render (entry -> solver -> hooks) where the old
// single bundle needed one, and on a throttled phone the third hop was most of
// the LCP regression on pages where the solver is the largest element.
//
// Statically importing it here puts hooks in the entry instead, so a solver page
// is entry -> solver and the hooks chunk stops existing. Costs ~2.7kB on the
// entry, which every page that mounts a solver was going to fetch anyway.
import "preact/hooks";

// Shared infrastructure, not a solver — and imported statically for the same
// chunking reason as preact/hooks above. Every solver calls useSolverReport, so
// leaving this to be discovered through the dynamic imports would hoist it into a
// second shared chunk sitting between the entry and every solver.
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
 * hydrate(), not render(), because the production build already put this
 * solver's markup in the page (eleventy.config.cjs `prerenderSolvers`). Preact
 * then walks the DOM that is already there and only wires up handlers and state,
 * creating nothing — so the page does not move when a chunk lands, which is what
 * the split otherwise cost: CLS 1.23 on the five-solver page against 0.000
 * before it.
 *
 * hydrate() into an EMPTY container behaves like render(), which is what keeps
 * `eleventy --serve` on its own working: no SSR build, empty divs, client builds
 * the DOM exactly as it used to. One code path covers both.
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
