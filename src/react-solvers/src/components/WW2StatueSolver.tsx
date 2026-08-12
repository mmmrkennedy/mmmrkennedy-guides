import { useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

type WallID = "wall1" | "wall2" | "wall3" | "wall4";
type StatueIndex = 0 | 1 | 2 | 3;
type RotationValue = 0 | 1 | 2 | 3;
type PuzzleID = 0 | 1 | 2 | 3;
type RotationList = [RotationValue, RotationValue, RotationValue, RotationValue];

const DIRECTION_SYMBOLS: string[] = ["↑", "→", "↓", "←"];
const STATUE_LABELS: string[] = ["A", "B", "C", "D"];
// All statues facing down — the in-game solved position, and the starting point.
const DEFAULT_DIRECTIONS: RotationList = [2, 2, 2, 2];
const PUZZLE_OFFSETS: number[][] = [
    [1, 1, 1],
    [1, 2, 1, 1],
    [2, 1, 1, 2],
    [1, 3, 1, 2],
];

function adjustStatueDirection(directions: RotationList, offsets: number[], statueIndex: StatueIndex): RotationList {
    const newDirections: RotationList = [...directions];
    newDirections[statueIndex] = ((newDirections[statueIndex] + offsets[statueIndex]) % 4) as RotationValue;
    return newDirections;
}

function adjustStatueAndNeighbors3(directions: RotationList, offsets: number[], statueIndex: StatueIndex) {
    let newDirections: RotationList = [...directions];
    if (statueIndex > 0) {
        newDirections = adjustStatueDirection(newDirections, offsets, (statueIndex - 1) as RotationValue);
    }
    newDirections = adjustStatueDirection(newDirections, offsets, statueIndex);
    if (statueIndex < 2) {
        newDirections = adjustStatueDirection(newDirections, offsets, (statueIndex + 1) as RotationValue);
    }
    return newDirections;
}

function adjustStatueAndNeighbors4(directions: RotationList, offsets: number[], statueIndex: StatueIndex) {
    let newDirections: RotationList = [...directions];
    if (statueIndex > 0) {
        newDirections = adjustStatueDirection(newDirections, offsets, (statueIndex - 1) as RotationValue);
    }
    newDirections = adjustStatueDirection(newDirections, offsets, statueIndex);
    if (statueIndex < 3) {
        newDirections = adjustStatueDirection(newDirections, offsets, (statueIndex + 1) as RotationValue);
    }
    return newDirections;
}

function get_num_needed_rotations(direction: number, offset: number): number {
    let rotations = 0;
    while ((offset * rotations + direction) % 4 !== 2) {
        rotations++;
        if (rotations > 5) {
            rotations = -1;
            break;
        }
    }
    return rotations;
}

function solvePuzzle(directions: RotationList, puzzleID: PuzzleID): string[] {
    const offsets = PUZZLE_OFFSETS[puzzleID - 1];
    let workingDirections: RotationList = [...directions];
    const lines: string[] = [];

    // Validate input directions
    for (let i = 0; i < workingDirections.length; i++) {
        if (offsets[i] === 2 && (workingDirections[i] === 1 || workingDirections[i] === 3)) {
            return [`Invalid input - check Statue ${STATUE_LABELS[i]}.`];
        }
    }

    if (puzzleID === 1) {
        let turnsA = 0;
        while (workingDirections[1] !== workingDirections[2]) {
            workingDirections = adjustStatueAndNeighbors3(workingDirections, offsets, 0);
            turnsA++;
            if (turnsA > 30) return [`Unable to solve. Check that statues are correct (failed at A).`];
        }
        if (turnsA > 0) lines.push(`Turn statue A ${turnsA}×`);

        let turnsC = 0;
        while (workingDirections[0] !== workingDirections[1]) {
            workingDirections = adjustStatueAndNeighbors3(workingDirections, offsets, 2);
            turnsC++;
            if (turnsC > 30) return [`Unable to solve. Check that statues are correct (failed at C).`];
        }
        if (turnsC > 0) lines.push(`Turn statue C ${turnsC}×`);

        let turnsB = 0;
        while (workingDirections[1] !== 2) {
            workingDirections = adjustStatueAndNeighbors3(workingDirections, offsets, 1);
            turnsB++;
            if (turnsB > 30) return [`Unable to solve. Check that statues are correct (failed at B).`];
        }
        if (turnsB > 0) lines.push(`Turn statue B ${turnsB}×`);
    } else {
        let turnsC = 0;
        let neededRotations0 = get_num_needed_rotations(workingDirections[0], offsets[0]);
        let neededRotations1 = get_num_needed_rotations(workingDirections[1], offsets[1]);

        while (neededRotations0 !== neededRotations1) {
            if (
                ((offsets[0] === 2 && neededRotations1 % 2 === neededRotations0) ||
                    (offsets[1] === 2 && neededRotations0 % 2 === neededRotations1))
            ) {
                break;
            }
            workingDirections = adjustStatueAndNeighbors4(workingDirections, offsets, 2);
            turnsC++;
            neededRotations0 = get_num_needed_rotations(workingDirections[0], offsets[0]);
            neededRotations1 = get_num_needed_rotations(workingDirections[1], offsets[1]);
        }
        if (turnsC > 0) lines.push(`Turn statue C ${turnsC}×`);

        let turnsB = 0;
        let neededRotations2 = get_num_needed_rotations(workingDirections[2], offsets[2]);
        let neededRotations3 = get_num_needed_rotations(workingDirections[3], offsets[3]);

        while (neededRotations2 !== neededRotations3) {
            if (
                ((offsets[2] === 2 && neededRotations3 % 2 === neededRotations2) ||
                    (offsets[3] === 2 && neededRotations2 % 2 === neededRotations3))
            ) {
                break;
            }
            workingDirections = adjustStatueAndNeighbors4(workingDirections, offsets, 1);
            turnsB++;
            neededRotations2 = get_num_needed_rotations(workingDirections[2], offsets[2]);
            neededRotations3 = get_num_needed_rotations(workingDirections[3], offsets[3]);
        }
        if (turnsB > 0) lines.push(`Turn statue B ${turnsB}×`);

        let turnsA = 0;
        while (workingDirections[0] !== 2 || workingDirections[1] !== 2) {
            workingDirections = adjustStatueAndNeighbors4(workingDirections, offsets, 0);
            turnsA++;
        }
        if (turnsA > 0) lines.push(`Turn statue A ${turnsA}×`);

        let turnsD = 0;
        while (workingDirections[2] !== 2 || workingDirections[3] !== 2) {
            workingDirections = adjustStatueAndNeighbors4(workingDirections, offsets, 3);
            turnsD++;
        }
        if (turnsD > 0) lines.push(`Turn statue D ${turnsD}×`);
    }

    if (lines.length === 0) return ["Already solved!"];
    return lines;
}

export default function WW2StatueSolver({ title }: { title?: string }) {
    const [activeWall, setActiveWall] = useState<WallID>("wall1");
    const [directions, setDirections] = useState<RotationList>(DEFAULT_DIRECTIONS);

    // Wall 1 has three statues, the rest have four, so the list is trimmed to the
    // wall actually being solved — the fourth slot on wall 1 is stale, not input.
    useSolverReport("StatueSolver", () => {
        const count = activeWall === "wall1" ? 3 : 4;
        return {
            Wall: activeWall,
            "Statue directions": directions
                .slice(0, count)
                .map((d, i) => `${i + 1}: ${DIRECTION_SYMBOLS[d]}`),
            "Statue directions (raw 0-3)": directions.slice(0, count),
        };
    });
    // Re-solved by every handler below, so the output tracks the statues live.
    // Null only until the first interaction, which is when the nudge shows.
    const [result, setResult] = useState<string[] | null>(null);

    const statueCount = activeWall === "wall1" ? 3 : 4;

    function puzzleIdFor(wall: WallID): PuzzleID {
        return Number(wall.replace("wall", "")) as PuzzleID;
    }

    function handleWallClick(wallId: WallID) {
        setActiveWall(wallId);
        setResult(solvePuzzle([...directions], puzzleIdFor(wallId)));
    }

    function handleStatueClick(statueIndex: StatueIndex) {
        const newDirections: RotationList = [...directions];
        newDirections[statueIndex] = ((newDirections[statueIndex] + 1) % 4) as RotationValue;
        setDirections(newDirections);
        setResult(solvePuzzle([...newDirections], puzzleIdFor(activeWall)));
    }

    // Redundant now that every input re-solves. Kept commented, alongside its
    // button below, so auto-solve can be backed out in one edit.
    // function handleSolve() {
    //     setResult(solvePuzzle([...directions], puzzleIdFor(activeWall)));
    // }

    // Back to the untouched state, nudge and all — not "Already solved!".
    function handleReset() {
        setDirections(DEFAULT_DIRECTIONS);
        setResult(null);
    }

    return (
        <div className="solver-container solver-container--statue">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Pick the wall you're solving, then click each statue to cycle its facing direction (↑ → ↓ ←) until they match the in-game positions. The turn instructions update as you go.
            </p>

            <div className="solver-controls is-centered" role="group" aria-label="Wall picker">
                {(["wall1", "wall2", "wall3", "wall4"] as const).map((wall, i) => (
                    <button
                        key={wall}
                        type="button"
                        className={`btn btn--solver${activeWall === wall ? " is-active" : ""}`}
                        aria-pressed={activeWall === wall}
                        onClick={() => handleWallClick(wall)}
                    >
                        Wall {i + 1}
                    </button>
                ))}
            </div>

            <p className="statue-hint">Down = facing front, Up = facing back</p>

            <div className="statue-row">
                <div className="statue-row__buttons">
                    {Array.from({ length: statueCount }, (_, i) => (
                        <button
                            key={i}
                            type="button"
                            className="btn btn--solver"
                            aria-label={`Statue ${STATUE_LABELS[i]}, currently ${DIRECTION_SYMBOLS[directions[i]]}`}
                            onClick={() => handleStatueClick(i as StatueIndex)}
                        >
                            {DIRECTION_SYMBOLS[directions[i]]}
                        </button>
                    ))}
                </div>
                <div className="statue-row__labels" aria-hidden="true">
                    {STATUE_LABELS.slice(0, statueCount).map((label) => (
                        <span key={label}>{label}</span>
                    ))}
                </div>
            </div>

            <div className="solver-controls">
                {/* Superseded by auto-solve — restore this and handleSolve together.
                <button type="button" className="btn btn--solver" onClick={handleSolve}>Solve</button>
                */}
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output" aria-live="polite">
                {result ? (
                    result.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                    <p style={{ color: "var(--color-text-muted)" }}>Set the statues to their in-game directions.</p>
                )}
            </div>
        </div>
    );
}