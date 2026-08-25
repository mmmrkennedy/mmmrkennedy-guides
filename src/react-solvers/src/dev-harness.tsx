// Development preview only — the "All Solvers" page at src/react-solvers/index.html.
//
// Split out of main.tsx when the build moved to per-solver chunks. main.tsx now
// reaches every component through dynamic import(); this file is the one place
// that still imports them statically, because it genuinely does render all 20 at
// once. Keeping it here rather than in main.tsx means those static imports end up
// in a chunk that only the dev page loads, instead of in the entry that every
// guide on the site downloads.
//
// main.tsx imports this dynamically, guarded on #root existing.

import { render } from "preact";
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
import IWChemicalStepSolver from "./components/IWChemicalStepSolver";
import IWChemicalStepSolverV2 from "./components/IWChemicalStepSolverV2";
import IWGnSSkull4Solver from "./components/IWGnSSkull4Solver";
import IWBeastEightQueensSolver from "./components/IWBeastEightQueensSolver";
import IWBeastFloppySolver from "./components/IWBeastFloppySolver";
import IWBeastVenomXMazeSolver from "./components/IWBeastVenomXMazeSolver";
import IWBeastVenomXBoxSolver from "./components/IWBeastVenomXBoxSolver";
import IWBeastVenomYMorseSolver from "./components/IWBeastVenomYMorseSolver";
import BO1DialSolver from "./components/BO1DialSolver";
import BO7TotenreichReactorSolver from "./components/BO7TotenreichReactorSolver";
import SimonSaysSolver from "./components/SimonSaysSolver";

const devRoot = document.getElementById("root");
if (devRoot) {
    render(
        <div>
            <BO7TotenreichReactorSolver title="Totenreich Reactor Solver" />
            {/* Configured per page rather than per map, so two are shown: the
                four-pad case every simon-says puzzle starts from, and a wider
                palette to check the pads and the slots still wrap. */}
            <SimonSaysSolver
                title="Simon Says Solver (4 colours)"
                colours={["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"]}
            />
            <SimonSaysSolver
                title="Simon Says Solver (7 colours)"
                colours={["#e74c3c", "#e87500", "#f1c40f", "#2ecc71", "#5dade2", "#8b2fc9", "#ecf0f1"]}
            />
            {/* Named pads, including one left blank to fall back to its colour. */}
            <SimonSaysSolver
                title="Simon Says Solver (named pads)"
                colours={["#daf7f7", "#aafcff", "#f8eec5", "#ed9bf7"]}
                names={["Bar", "Atrium", "", "Vault"]}
            />
            <BO1DialSolver title="COTD Dials Solver" />
            <IWBeastVenomXMazeSolver title="Beast Venom X Maze Solver" />
            <IWBeastVenomXBoxSolver title="Beast Venom X Box Solver" />
            <IWBeastVenomYMorseSolver title="Beast Venom Y/Z Morse Solver" />
            <IWBeastVenomYMorseSolver
                title="Beast Venom Y/Z Morse Solver (key from dropdown)"
                keySelectId="venom-y-key-selector"
            />
            <IWBeastFloppySolver title="Beast Floppy Disk Solver" />
            <IWBeastEightQueensSolver title="Beast Eight Queens Solver" />
            <IWGnSSkull4Solver title="Attack GnS Skull 4 Solver" />
            <IWChemicalStepSolverV2 title="Attack Chemical Step Solver (live)" />
            <IWChemicalStepSolver title="Attack Chemical Step Solver (old, no longer mounted)" />
            <IWMainQuestWordFilter title="Shaolin Main Quest Word Filter" />
            <IWMahjongSolver title="Mahjong Solver" />
            <WW2HangmanSolver title="Hangman Solver" />
            <WW2StatueSolver title="Statue Solver" />
            <WW2HammerPuzzleSolver title="Lightning Hammer Solver" />
            <BO3ValveSolver title="Valve Solver" />
            <BO6BeamsmasherMathSolver title="Beamsmasher Solver" />
            <BO6MaxisItemsSolver title="Maxis Items Solver" />
            <BO6PeriodicTableSolver title="Periodic Table Solver" />
            <BO6LetterboardSolver title="Letterboard Solver" />
        </div>,
        devRoot,
    );
}
