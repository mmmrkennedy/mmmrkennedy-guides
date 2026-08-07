import { render } from "preact";
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

// Every solver lives behind its own dynamic import() below, which is what makes
// Vite emit one chunk per solver instead of a single 28.9kB brotli bundle
// carrying all 19 to every guide page. Do NOT add a static
// `import X from "./components/X"` here — one is enough to pull that component
// back into the entry chunk and quietly undo the split for that solver.

interface MountOptions {
    title?: string;
    /* Morse solver only: id of an existing ARCHER/CROSS <select> to adopt. */
    keySelectId?: string;
}

type MountFunction = (elementId: string, options?: MountOptions) => void;

interface ZombiesSolvers {
    mountTotenreichReactorSolver: MountFunction;
    mountHangmanSolver: MountFunction;
    mountStatueSolver: MountFunction;
    mountHammerSolver: MountFunction;
    mountValveSolver: MountFunction;
    mountBeamsmasherSolver: MountFunction;
    mountMaxisItemsSolver: MountFunction;
    mountPeriodicTableSolver: MountFunction;
    mountLetterboardSolver: MountFunction;
    mountMahjongSolver: MountFunction;
    mountShaolinWordFilter: MountFunction;
    mountChemicalStepSolver: MountFunction;
    mountAttackGnSSkull4Solver: MountFunction;
    mountBeastGnSEightQueensSolver: MountFunction;
    mountBeastFloppyDiskSolver: MountFunction;
    mountBeastVenomXMazeSolver: MountFunction;
    mountBeastVenomXBoxSolver: MountFunction;
    mountBeastVenomYMorseSolver: MountFunction;
    mountDialSolver: MountFunction;
}

declare global {
    interface Window {
        ZombiesSolvers: ZombiesSolvers;
    }
}

/**
 * Fetch a solver's chunk, then render it into `elementId`.
 *
 * The element lookup happens before the import, not after: a missing id is a
 * page-authoring mistake, and it should be reported straight away rather than
 * after a pointless network round trip.
 *
 * Mounting is now asynchronous. Nothing on a guide page awaits it — the call
 * sites are fire-and-forget inside a DOMContentLoaded handler — so the only
 * visible effect is that the solver paints a moment later than it used to. Give
 * .solver-container a reserved height so that moment cannot shift the page.
 */
function mount<P extends MountOptions>(
    elementId: string,
    label: string,
    load: () => Promise<{ default: ComponentType<P> }>,
    props: P,
) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`mount${label}: element not found:`, elementId);
        return;
    }
    load()
        .then(({ default: Solver }) => render(<Solver {...props} />, element))
        .catch((error) => console.error(`mount${label}: failed to load solver chunk:`, error));
}

// Assigned synchronously, on module evaluation. Guide pages call these from a
// DOMContentLoaded handler that falls back to console.error when the global is
// missing, and a module script always finishes evaluating before that event
// fires — so the contract holds. Deferring this assignment (behind an
// IntersectionObserver, say) would break every solver page.
window.ZombiesSolvers = {
    mountTotenreichReactorSolver: (id, opts) =>
        mount(id, "TotenreichReactorSolver", () => import("./components/BO7TotenreichReactorSolver"), { title: opts?.title }),
    mountDialSolver: (id, opts) => mount(id, "DialSolver", () => import("./components/BO1DialSolver"), { title: opts?.title }),
    mountHangmanSolver: (id, opts) => mount(id, "HangmanSolver", () => import("./components/WW2HangmanSolver"), { title: opts?.title }),
    mountStatueSolver: (id, opts) => mount(id, "StatueSolver", () => import("./components/WW2StatueSolver"), { title: opts?.title }),
    mountHammerSolver: (id, opts) => mount(id, "HammerSolver", () => import("./components/WW2HammerPuzzleSolver"), { title: opts?.title }),
    mountValveSolver: (id, opts) => mount(id, "ValveSolver", () => import("./components/BO3ValveSolver"), { title: opts?.title }),
    mountBeamsmasherSolver: (id, opts) =>
        mount(id, "BeamsmasherSolver", () => import("./components/BO6BeamsmasherMathSolver"), { title: opts?.title }),
    mountMaxisItemsSolver: (id, opts) => mount(id, "MaxisItemsSolver", () => import("./components/BO6MaxisItemsSolver"), { title: opts?.title }),
    mountPeriodicTableSolver: (id, opts) =>
        mount(id, "PeriodicTableSolver", () => import("./components/BO6PeriodicTableSolver"), { title: opts?.title }),
    mountLetterboardSolver: (id, opts) =>
        mount(id, "LetterboardSolver", () => import("./components/BO6LetterboardSolver"), { title: opts?.title }),
    mountMahjongSolver: (id, opts) => mount(id, "MahjongSolver", () => import("./components/IWMahjongSolver"), { title: opts?.title }),
    mountShaolinWordFilter: (id, opts) => mount(id, "ShaolinWordFilter", () => import("./components/IWMainQuestWordFilter"), { title: opts?.title }),
    mountChemicalStepSolver: (id, opts) =>
        mount(id, "ChemicalStepSolver", () => import("./components/IWChemicalStepSolver"), { title: opts?.title }),
    mountAttackGnSSkull4Solver: (id, opts) =>
        mount(id, "AttackGnSSkull4Solver", () => import("./components/IWGnSSkull4Solver"), { title: opts?.title }),
    mountBeastGnSEightQueensSolver: (id, opts) =>
        mount(id, "BeastGnSEightQueensSolver", () => import("./components/IWBeastEightQueensSolver"), { title: opts?.title }),
    mountBeastFloppyDiskSolver: (id, opts) =>
        mount(id, "BeastFloppyDiskSolver", () => import("./components/IWBeastFloppySolver"), { title: opts?.title }),
    mountBeastVenomXMazeSolver: (id, opts) =>
        mount(id, "BeastVenomXMazeSolver", () => import("./components/IWBeastVenomXMazeSolver"), { title: opts?.title }),
    mountBeastVenomXBoxSolver: (id, opts) =>
        mount(id, "BeastVenomXBoxSolver", () => import("./components/IWBeastVenomXBoxSolver"), { title: opts?.title }),
    mountBeastVenomYMorseSolver: (id, opts) =>
        mount(id, "BeastVenomYMorseSolver", () => import("./components/IWBeastVenomYMorseSolver"), {
            title: opts?.title,
            keySelectId: opts?.keySelectId,
        }),
};

// Dev preview only (src/react-solvers/index.html), which renders all 19 at once.
// Behind its own dynamic import so the static imports it needs land in a chunk
// nobody but that page ever downloads — importing it here directly would drag
// every solver back into the entry.
if (document.getElementById("root")) {
    void import("./dev-harness");
}
