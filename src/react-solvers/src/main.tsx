import { render } from "preact";
import "../../css/styles.css";
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
import IWGnSSkull4Solver from "./components/IWGnSSkull4Solver";
import IWBeastEightQueensSolver from "./components/IWBeastEightQueensSolver";
import IWBeastFloppySolver from "./components/IWBeastFloppySolver";
import IWBeastVenomXMazeSolver from "./components/IWBeastVenomXMazeSolver";
import IWBeastVenomXBoxSolver from "./components/IWBeastVenomXBoxSolver";
import BO1DialSolver from "./components/BO1DialSolver";
import BO7TotenreichReactorSolver from "./components/BO7TotenreichReactorSolver";

interface MountOptions {
    title?: string;
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
    mountDialSolver: MountFunction;
}

declare global {
    interface Window {
        ZombiesSolvers: ZombiesSolvers;
    }
}

function mount(elementId: string, label: string, node: preact.VNode /*, options?: MountOptions */) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`mount${label}: element not found:`, elementId);
        return;
    }
    render(node, element);
}

// Global namespace for all solvers
window.ZombiesSolvers = {
    mountTotenreichReactorSolver: (id, opts) => mount(id, "TotenreichReactorSolver", <BO7TotenreichReactorSolver title={opts?.title} />),
    mountDialSolver: (id, opts) => mount(id, "DialSolver", <BO1DialSolver title={opts?.title} />),
    mountHangmanSolver: (id, opts) => mount(id, "HangmanSolver", <WW2HangmanSolver title={opts?.title} />),
    mountStatueSolver: (id, opts) => mount(id, "StatueSolver", <WW2StatueSolver title={opts?.title} />),
    mountHammerSolver: (id, opts) => mount(id, "HammerSolver", <WW2HammerPuzzleSolver title={opts?.title} />),
    mountValveSolver: (id, opts) => mount(id, "ValveSolver", <BO3ValveSolver title={opts?.title} />),
    mountBeamsmasherSolver: (id, opts) => mount(id, "BeamsmasherSolver", <BO6BeamsmasherMathSolver title={opts?.title} />),
    mountMaxisItemsSolver: (id, opts) => mount(id, "MaxisItemsSolver", <BO6MaxisItemsSolver title={opts?.title} />),
    mountPeriodicTableSolver: (id, opts) => mount(id, "PeriodicTableSolver", <BO6PeriodicTableSolver title={opts?.title} />),
    mountLetterboardSolver: (id, opts) => mount(id, "LetterboardSolver", <BO6LetterboardSolver title={opts?.title} />),
    mountMahjongSolver: (id, opts) => mount(id, "MahjongSolver", <IWMahjongSolver title={opts?.title} />),
    mountShaolinWordFilter: (id, opts) => mount(id, "ShaolinWordFilter", <IWMainQuestWordFilter title={opts?.title} />),
    mountChemicalStepSolver: (id, opts) => mount(id, "ChemicalStepSolver", <IWChemicalStepSolver title={opts?.title} />),
    mountAttackGnSSkull4Solver: (id, opts) => mount(id, "AttackGnSSkull4Solver", <IWGnSSkull4Solver title={opts?.title} />),
    mountBeastGnSEightQueensSolver: (id, opts) => mount(id, "BeastGnSEightQueensSolver", <IWBeastEightQueensSolver title={opts?.title} />),
    mountBeastFloppyDiskSolver: (id, opts) => mount(id, "BeastFloppyDiskSolver", <IWBeastFloppySolver title={opts?.title} />),
    mountBeastVenomXMazeSolver: (id, opts) => mount(id, "BeastVenomXMazeSolver", <IWBeastVenomXMazeSolver title={opts?.title} />),
    mountBeastVenomXBoxSolver: (id, opts) => mount(id, "BeastVenomXBoxSolver", <IWBeastVenomXBoxSolver title={opts?.title} />),
};

// For test page: auto-mount all solvers
const devRoot = document.getElementById("root");
if (devRoot) {
    render(
        <div>
            <BO7TotenreichReactorSolver title="Totenreich Reactor Solver" />
            <BO1DialSolver title="COTD Dials Solver" />
            <IWBeastVenomXMazeSolver title="Beast Venom X Maze Solver" />
            <IWBeastVenomXBoxSolver title="Beast Venom X Box Solver" />
            <IWBeastFloppySolver title="Beast Floppy Disk Solver" />
            <IWBeastEightQueensSolver title="Beast Eight Queens Solver" />
            <IWGnSSkull4Solver title="Attack GnS Skull 4 Solver" />
            <IWChemicalStepSolver title="Attack Chemical Step Solver" />
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
