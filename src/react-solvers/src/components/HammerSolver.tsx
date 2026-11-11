import { useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

type Direction = 0 | 1 | 2 | 3;
type BlockId = 0 | 1 | 2 | 3;
type DirectionsArray = [Direction, Direction, Direction, Direction];

const DIRECTION_SYMBOLS: string[] = ["↓", "→", "↑", "←"];
const LABELS: string[] = ["A", "B", "C", "D"];

function shotsToFaceForward(currDirections: DirectionsArray, id: BlockId): number {
    return (4 - currDirections[id]) % 4;
}

function updateDirectionsAfterShots(
    currDirections: DirectionsArray,
    targetId: BlockId,
    shotCount: number,
): DirectionsArray {
    const newDirections: DirectionsArray = [...currDirections];

    if (targetId === 1) {
        newDirections[0] = ((currDirections[0] + shotCount) % 4) as Direction;
        newDirections[1] = ((currDirections[1] + shotCount * 2) % 4) as Direction;
        newDirections[2] = ((currDirections[2] + shotCount) % 4) as Direction;
    } else if (targetId === 2) {
        newDirections[1] = ((currDirections[1] + shotCount) % 4) as Direction;
        newDirections[2] = ((currDirections[2] + shotCount * 2) % 4) as Direction;
        newDirections[3] = ((currDirections[3] + shotCount) % 4) as Direction;
    } else if (targetId === 3) {
        newDirections[2] = ((currDirections[2] + shotCount) % 4) as Direction;
        newDirections[3] = ((currDirections[3] + shotCount * 2) % 4) as Direction;
    }

    return newDirections;
}

function solveLogic(directions: DirectionsArray): number[] {
    const shootCounts: number[] = [0, 0, 0, 0];
    let currDirections: DirectionsArray = [...directions];

    // Shoot B, C, D in turn to face A, B, C forward; D's leftover state then
    // needs a fixed A/B/C combo below.
    const shotsForB = shotsToFaceForward(currDirections, 0);
    shootCounts[1] = shotsForB;
    currDirections = updateDirectionsAfterShots(currDirections, 1, shotsForB);

    const shotsForC = shotsToFaceForward(currDirections, 1);
    shootCounts[2] = shotsForC;
    currDirections = updateDirectionsAfterShots(currDirections, 2, shotsForC);

    const shotsForD = shotsToFaceForward(currDirections, 2);
    shootCounts[3] = shotsForD;
    currDirections = updateDirectionsAfterShots(currDirections, 3, shotsForD);

    const blockDDir = currDirections[3];
    if (blockDDir === 1) {
        shootCounts[0] += 1;
        shootCounts[1] += 2;
        shootCounts[2] += 3;
    } else if (blockDDir === 2) {
        shootCounts[0] += 2;
        shootCounts[2] += 2;
    } else if (blockDDir === 3) {
        shootCounts[0] += 3;
        shootCounts[1] += 2;
        shootCounts[2] += 1;
    }

    return shootCounts.map((num) => num % 4);
}

function buildSolutionLines(directions: DirectionsArray): string[] {
    const counts = solveLogic(directions);
    const lines: string[] = [];
    counts.forEach((count, i) => {
        if (count > 0) lines.push(`Shoot ${LABELS[i]} ${count}×`);
    });
    if (lines.length === 0) return ["Already solved!"];
    return lines;
}

export default function HammerSolver({ title }: { title?: string }) {
    const [directions, setDirections] = useState<DirectionsArray>([0, 0, 0, 0]);

    useSolverReport("HammerSolver", () => ({
        "Block directions (A-D)": directions.map((d, i) => `${LABELS[i]}: ${DIRECTION_SYMBOLS[d]}`),
        "Block directions (raw 0-3)": [...directions],
    }));
    const [result, setResult] = useState<string[] | null>(null);

    const cycleDirection = (blockId: BlockId) => {
        const next: DirectionsArray = [...directions];
        next[blockId] = ((next[blockId] + 1) % 4) as Direction;
        setDirections(next);
        setResult(buildSolutionLines(next));
    };

    const handleReset = () => {
        setDirections([0, 0, 0, 0]);
        setResult(null);
    };

    return (
        <div className="solver-container solver-container--hammer">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click each block to cycle its facing direction (↓ → ↑ ←) until they match the in-game positions. The shot instructions update as you go.
            </p>

            <p className="statue-hint">Down = facing front, Up = facing back</p>

            <div className="hammer-row">
                {LABELS.map((label, i) => (
                    <div className="hammer-row__item" key={label}>
                        <span className="hammer-row__label" aria-hidden="true">{label}</span>
                        <button
                            type="button"
                            className="btn btn--solver"
                            aria-label={`Block ${label}, currently ${DIRECTION_SYMBOLS[directions[i]]}`}
                            onClick={() => cycleDirection(i as BlockId)}
                        >
                            {DIRECTION_SYMBOLS[directions[i]]}
                        </button>
                    </div>
                ))}
            </div>

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output" aria-live="polite">
                {result ? (
                    result.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                    <p style={{ color: "var(--color-text-muted)" }}>Set the blocks to their in-game directions.</p>
                )}
            </div>
        </div>
    );
}