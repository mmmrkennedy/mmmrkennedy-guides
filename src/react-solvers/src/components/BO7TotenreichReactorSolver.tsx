import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useSolverReport } from "../solver-report";

type CellType = "empty" | "rod";
type Phase = "setup" | "results";
type Confidence = "high" | "med" | "low";

const defaultMessage = "Click cells to place control rods, then click Solve to see the valid Uranium Rod placements.";

function makeGrid(): CellType[][] {
    return Array.from({ length: 4 }, () => Array(4).fill("empty") as CellType[]);
}

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function getActivated(grid: CellType[][], uraniumCells: [number, number][]): Set<string> {
    const activated = new Set<string>();
    for (const [ur, uc] of uraniumCells) {
        const queue: [number, number][] = [[ur, uc]];
        const visited = new Set<string>();
        while (queue.length > 0) {
            const [cr, cc] = queue.shift()!;
            for (const [dr, dc] of DIRS) {
                const nr = cr + dr, nc = cc + dc;
                const key = `${nr},${nc}`;
                if (nr >= 0 && nr < 4 && nc >= 0 && nc < 4 && grid[nr][nc] === "rod" && !visited.has(key)) {
                    visited.add(key);
                    activated.add(key);
                    queue.push([nr, nc]);
                }
            }
        }
    }
    return activated;
}

type Component = { size: number; uraniumCount: number };

function poweredComponents(grid: CellType[][], uraniumCells: [number, number][]): Component[] {
    const activated = getActivated(grid, uraniumCells);
    const uraniumSet = new Set<string>(uraniumCells.map(([r, c]) => `${r},${c}`));
    const powered = new Set<string>(uraniumSet);
    for (const key of activated) powered.add(key);

    const seen = new Set<string>();
    const components: Component[] = [];
    for (const key of powered) {
        if (seen.has(key)) continue;
        const [r, c] = key.split(",").map(Number);
        const q: [number, number][] = [[r, c]];
        seen.add(key);
        let size = 0;
        let uraniumCount = 0;
        while (q.length > 0) {
            const [cr, cc] = q.shift()!;
            size++;
            if (uraniumSet.has(`${cr},${cc}`)) uraniumCount++;
            for (const [dr, dc] of DIRS) {
                const nkey = `${cr + dr},${cc + dc}`;
                if (powered.has(nkey) && !seen.has(nkey)) {
                    seen.add(nkey);
                    q.push([cr + dr, cc + dc]);
                }
            }
        }
        components.push({ size, uraniumCount });
    }
    return components;
}

function baseScore(n: number): number {
    return 6.4 * n * n + 10.6 * n;
}

function computeScore(components: Component[]): {
    net: number;
    netNoBonus: number;
    bonus: number;
} {
    let netNoBonus = 0;
    let bonus = 0;

    for (const c of components) {
        if (c.uraniumCount === 0) continue;
        netNoBonus += baseScore(c.size);
        if (c.uraniumCount === 3) {
            bonus += baseScore(c.size) / 4;
        }
    }

    return { net: netNoBonus, netNoBonus, bonus };
}

const KEEP_NET_MIN = 383;
const KEEP_NET_MAX = 503;

function isKeepableScore(net: number): boolean {
    return net >= KEEP_NET_MIN && net <= KEEP_NET_MAX;
}

function combinations<T>(arr: T[], k: number): T[][] {
    if (k === 0) return [[]];
    if (arr.length < k) return [];
    const [first, ...rest] = arr;
    return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

type Solution = {
    placements: [number, number][];
    components: Component[];
    net: number;
    netNoBonus: number;
    bonus: number;
    confidence: Confidence;
};

const HIGH_NET_MIN = 383;
const HIGH_NET_MAX = 435;
const MED_NET_MIN = 436;
const MED_NET_MAX = 448;

function classifyConfidence(net: number): Confidence {
    if (net >= HIGH_NET_MIN && net <= HIGH_NET_MAX) return "high";
    if (net >= MED_NET_MIN && net <= MED_NET_MAX) return "med";
    return "low";
}

function findSolutions(grid: CellType[][]): Solution[] {
    const emptyCells: [number, number][] = [];
    for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
            if (grid[r][c] === "empty") emptyCells.push([r, c]);

    const results: Solution[] = [];
    for (const combo of combinations(emptyCells, 3)) {
        const placements = combo as [number, number][];
        const components = poweredComponents(grid, placements);
        const { net, netNoBonus, bonus } = computeScore(components);
        if (!isKeepableScore(net)) continue;
        const confidence = classifyConfidence(net);
        results.push({ placements, components, net, netNoBonus, bonus, confidence });
    }

    const confidenceRank: Record<Confidence, number> = { high: 0, med: 1, low: 2 };
    results.sort((a, b) => {
        const cDiff = confidenceRank[a.confidence] - confidenceRank[b.confidence];
        if (cDiff !== 0) return cDiff;
        return b.net - a.net;
    });
    return results;
}

export default function BO7TotenreichReactorSolver({ title }: { title?: string }) {
    const [grid, setGrid] = useState<CellType[][]>(makeGrid);
    const [phase, setPhase] = useState<Phase>("setup");
    const [solutions, setSolutions] = useState<Solution[]>([]);
    const [solutionIndex, setSolutionIndex] = useState<number>(0);
    const [debug, setDebug] = useState<boolean>(false);
    const [message, setMessage] = useState<string | JSX.Element>(defaultMessage);

    // The grid is the whole input. Reported as coordinates (what you'd re-click
    // to reproduce it) and as a picture of the board (what it looked like), since
    // a 4x4 of dots and hashes is faster to read than sixteen pairs of numbers.
    // `phase`, `solutions` and `solutionIndex` are all downstream of these and are
    // deliberately left out.
    useSolverReport("TotenreichReactorSolver", () => ({
        "Control rods placed": grid.flatMap((row, r) =>
            row.map((cell, c) => (cell === "rod" ? [r, c] : null)).filter(Boolean),
        ),
        "Grid (row by row, # = rod)": grid.map((row) =>
            row.map((cell) => (cell === "rod" ? "#" : ".")).join(""),
        ),
        "Debug mode": debug,
    }));

    const toggleCell = (r: number, c: number) => {
        if (phase !== "setup") return;
        setGrid((prev) => {
            if (prev[r][c] === "empty") {
                const rodCount = prev.flat().filter((c) => c === "rod").length;
                if (rodCount >= 6) return prev;
            }
            const next = prev.map((row) => [...row]) as CellType[][];
            next[r][c] = next[r][c] === "empty" ? "rod" : "empty";
            return next;
        });
    };

    const formatMessage = (sols: Solution[], idx: number): string | JSX.Element => {
        if (sols.length === 0) return "No solutions found. If the layout is correct, this configuration may be unwinnable.";
        const s = sols[idx];
        const colors: Record<Confidence, string> = {
            high: "var(--color-tip-text)",
            med: "var(--color-danger-text)",
            low: "var(--color-no-return-text)",
        };
        const labels: Record<Confidence, string> = {
            high: "High",
            med: "Med",
            low: "Low",
        };
        const score = Math.round(s.netNoBonus);
        return (
            <>
                Solution {idx + 1} of {sols.length} - Confidence:{" "}
                <span style={{ color: colors[s.confidence], fontWeight: "bold" }}>
                    {labels[s.confidence]}
                </span>
                {" "}- Score: {score}
            </>
        );
    };

    const handleSolve = () => {
        const sols = findSolutions(grid);
        setSolutions(sols);
        setSolutionIndex(0);
        setPhase("results");
        setMessage(formatMessage(sols, 0));
    };

    const handleReset = () => {
        setGrid(makeGrid());
        setPhase("setup");
        setSolutions([]);
        setSolutionIndex(0);
        setMessage(defaultMessage);
    };

    const navigate = (dir: 1 | -1) => {
        const newIndex = (solutionIndex + dir + solutions.length) % solutions.length;
        setSolutionIndex(newIndex);
        setMessage(formatMessage(solutions, newIndex));
    };

    const currentSolution = solutions[solutionIndex]?.placements ?? [];
    const uraniumSet = new Set(currentSolution.map(([r, c]) => `${r},${c}`));
    const activated =
        phase === "results" && currentSolution.length > 0
            ? getActivated(grid, currentSolution)
            : new Set<string>();

    const getCellClass = (r: number, c: number): string => {
        const key = `${r},${c}`;
        const base = "solver-cell reactor-cell";
        if (phase === "results") {
            if (uraniumSet.has(key)) return `${base} cell-uranium is-locked`;
            if (grid[r][c] === "rod") {
                return activated.has(key)
                    ? `${base} cell-activated is-locked`
                    : `${base} cell-rod is-locked`;
            }
            return `${base} is-locked`;
        }
        return grid[r][c] === "rod" ? `${base} cell-rod` : base;
    };

    const renderGrid = () => {
        const cells = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                cells.push(
                    <div
                        key={`reactor-${r}-${c}`}
                        className={getCellClass(r, c)}
                        onClick={() => toggleCell(r, c)}
                    />,
                );
            }
        }
        return cells;
    };

    const renderDebugPanel = () => {
        if (!debug) return null;
        const sol = solutions[solutionIndex];
        if (!sol) {
            return (
                <div className="solver-debug-panel">
                    {phase === "setup"
                        ? "Debug: place rods and click Solve to see score breakdown."
                        : "Debug: no solutions to inspect."}
                </div>
            );
        }
        const raw = Math.round(sol.net + 27);
        const rawNoBonus = Math.round(sol.netNoBonus + 27);
        const componentsStr = sol.components
            .map((c) => `n=${c.size} U=${c.uraniumCount} → ${baseScore(c.size).toFixed(1)}`)
            .join("\n  ");
        return (
            <div className="solver-debug-panel">
                {`Solution ${solutionIndex + 1}/${solutions.length}
Confidence:    ${sol.confidence}
Net (current): ${sol.net.toFixed(2)}    → raw ${raw}px
Net (no bonus):${sol.netNoBonus.toFixed(2)}    → raw ${rawNoBonus}px
Bonus applied: ${sol.bonus.toFixed(2)} ${sol.bonus > 0 ? "(all 3 U in one component)" : "(no bonus)"}
Components:
  ${componentsStr}`}
            </div>
        );
    };

    return (
        <div
            className="solver-container solver-container--totenreich-reactor"
            data-phase={phase}
        >
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">{message}</p>

            {/*<label className="solver-toggle">*/}
            {/*    <input*/}
            {/*        type="checkbox"*/}
            {/*        checked={debug}*/}
            {/*        onChange={(e) => setDebug((e.target as HTMLInputElement).checked)}*/}
            {/*    />*/}
            {/*    Debug mode*/}
            {/*</label>*/}

            <div className="solver-grid-wrapper">
                <div className="solver-grid is-framed">{renderGrid()}</div>
            </div>

            {phase === "setup" ? (
                <div className="solver-controls">
                    <button className="btn btn--solver" onClick={handleSolve}>Solve</button>
                    <button className="btn btn--solver" onClick={handleReset}>Reset</button>
                </div>
            ) : (
                <div className="solver-controls">
                    {solutions.length > 1 && (
                        <>
                            <button className="btn btn--solver" onClick={() => navigate(-1)}>Prev</button>
                            <button className="btn btn--solver" onClick={() => navigate(1)}>Next</button>
                        </>
                    )}
                    <button className="btn btn--solver" onClick={handleReset}>Reset</button>
                </div>
            )}

            {renderDebugPanel()}
        </div>
    );
}