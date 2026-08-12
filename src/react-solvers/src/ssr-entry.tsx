// Build-time only. Vite builds this separately (see vite.config.js `ssrBuild`)
// into dist/react-solvers-ssr/, which eleventy.config.cjs requires to render each
// solver's initial HTML straight into the page.
//
// WHY THIS FILE EXISTS SEPARATELY FROM main.tsx
//
// main.tsx reaches every component through dynamic import(), which is what gives
// each solver its own chunk. Prerendering needs the opposite: everything present
// synchronously so Node can call it. The two cannot share one loader map without
// one of them losing what it needs, so the registry is written twice.
//
// That duplication is checked, not trusted. build_scripts/check-solver-registry.cjs
// parses the mount names out of both files and fails the build if they disagree,
// so adding a solver to one and forgetting the other cannot ship.
//
// EVERY COMPONENT HERE MUST RENDER DETERMINISTICALLY. Same output in Node as in
// the browser on first render, or hydration mismatches. Audited 2026-08-07: no
// Math.random, Date.now, new Date, toLocale, crypto or performance.now anywhere
// in the 19, every useState initialiser is a static literal, and the only two
// browser globals used (window.addEventListener in the maze solver,
// document.getElementById in the morse solver) are inside useEffect, which does
// not run during server rendering. Keep it that way.

import type { ComponentType } from "preact";

import WW2HangmanSolver from "./components/WW2HangmanSolver";
import WW2StatueSolver from "./components/WW2StatueSolver";
import WW2HammerPuzzleSolver from "./components/WW2HammerPuzzleSolver";
import BO6BeamsmasherMathSolver from "./components/BO6BeamsmasherMathSolver";
import BO3ValveSolver from "./components/BO3ValveSolver";
import BO6MaxisItemsSolver from "./components/BO6MaxisItemsSolver";
import BO6PeriodicTableSolver from "./components/BO6PeriodicTableSolver";
import BO6LetterboardSolver from "./components/BO6LetterboardSolver";
import IWMahjongSolver from "./components/IWMahjongSolver";
import IWMainQuestWordFilter from "./components/IWMainQuestWordFilter";
import IWChemicalStepSolverV2 from "./components/IWChemicalStepSolverV2";
import IWGnSSkull4Solver from "./components/IWGnSSkull4Solver";
import IWBeastEightQueensSolver from "./components/IWBeastEightQueensSolver";
import IWBeastFloppySolver from "./components/IWBeastFloppySolver";
import IWBeastVenomXMazeSolver from "./components/IWBeastVenomXMazeSolver";
import IWBeastVenomXBoxSolver from "./components/IWBeastVenomXBoxSolver";
import IWBeastVenomYMorseSolver from "./components/IWBeastVenomYMorseSolver";
import BO1DialSolver from "./components/BO1DialSolver";
import BO7TotenreichReactorSolver from "./components/BO7TotenreichReactorSolver";

export interface SolverProps {
    title?: string;
    keySelectId?: string;
}

/* Keys are the window.ZombiesSolvers method names, so eleventy can look a
   component up directly from the mountX() call it finds in the page. */
export const solvers: Record<string, ComponentType<SolverProps>> = {
    mountTotenreichReactorSolver: BO7TotenreichReactorSolver,
    mountDialSolver: BO1DialSolver,
    mountHangmanSolver: WW2HangmanSolver,
    mountStatueSolver: WW2StatueSolver,
    mountHammerSolver: WW2HammerPuzzleSolver,
    mountValveSolver: BO3ValveSolver,
    mountBeamsmasherSolver: BO6BeamsmasherMathSolver,
    mountMaxisItemsSolver: BO6MaxisItemsSolver,
    mountPeriodicTableSolver: BO6PeriodicTableSolver,
    mountLetterboardSolver: BO6LetterboardSolver,
    mountMahjongSolver: IWMahjongSolver,
    mountShaolinWordFilter: IWMainQuestWordFilter,
    mountChemicalStepSolver: IWChemicalStepSolverV2,
    mountAttackGnSSkull4Solver: IWGnSSkull4Solver,
    mountBeastGnSEightQueensSolver: IWBeastEightQueensSolver,
    mountBeastFloppyDiskSolver: IWBeastFloppySolver,
    mountBeastVenomXMazeSolver: IWBeastVenomXMazeSolver,
    mountBeastVenomXBoxSolver: IWBeastVenomXBoxSolver,
    mountBeastVenomYMorseSolver: IWBeastVenomYMorseSolver,
};
