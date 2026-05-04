import { useState } from "preact/hooks";

type CellType = "empty" | "rod";
type Phase = "setup" | "results";

const defaultMessage = "Experimental! Scoring formula is still being reverse-engineered and may not work. Message \"Mark\" on the discord if you find an incorrect solution. Click cells to place control rods, then click Solve.";

function makeGrid(): CellType[][] {
    return Array.from({ length: 4 }, () => Array(4).fill("empty") as CellType[]);
}

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// Returns the activated rod set (union across all uranium) — used for display only.
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

// Connected components of (uranium cells ∪ activated rods), returns size + U count per component.
// Two uranium touching the same rod cluster merge into one component.
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

// Base score per component: f(n) = 6.4n² + 10.6n
function baseScore(n: number): number {
    return 6.4 * n * n + 10.6 * n;
}

// Compute total net score using best-known formula.
// Base: Σ f(nᵢ) over U-containing components.
// Bonus: when all 3 U's share a single component, that component gets +f(n)/4.
// (Multi-group bonus for split U distributions is not yet pinned down — this
// solver flags those as "uncertain" rather than confidently winning.)
function computeScore(components: Component[]): { net: number; certain: boolean } {
    let net = 0;
    let allThreeInOne = false;
    let splitDistribution = false;

    for (const c of components) {
        if (c.uraniumCount === 0) continue;
        net += baseScore(c.size);
        if (c.uraniumCount === 3) {
            allThreeInOne = true;
            net += baseScore(c.size) / 4;
        } else if (c.uraniumCount > 0 && c.uraniumCount < 3) {
            splitDistribution = true;
        }
    }

    // We're confident when all 3 U's cluster (f(n)/4 rule fits data).
    // We're uncertain when U's split — bonus for that case isn't solved.
    const certain = allThreeInOne || !splitDistribution;
    return { net, certain };
}

// Green zone is 513–595px raw, baseline 27px → 486–568 net.
// Allow ±2px measurement variance.
const GREEN_MIN = 486;
const GREEN_MAX = 568;

type WinKind = "certain" | "likely" | "no";

function classifyWin(components: Component[]): WinKind {
    const { net, certain } = computeScore(components);
    if (net < GREEN_MIN || net > GREEN_MAX) {
        // Could still win via unknown bonus if uncertain — flag if close.
        if (!certain && net >= GREEN_MIN - 120 && net <= GREEN_MAX) return "likely";
        return "no";
    }
    return certain ? "certain" : "likely";
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
    kind: WinKind;
};

function findSolutions(grid: CellType[][]): Solution[] {
    const emptyCells: [number, number][] = [];
    for (let r = 0; r < 4; r++)
        for (let c = 0; c < 4; c++)
            if (grid[r][c] === "empty") emptyCells.push([r, c]);

    const results: Solution[] = [];
    for (const combo of combinations(emptyCells, 3)) {
        const placements = combo as [number, number][];
        const components = poweredComponents(grid, placements);
        const kind = classifyWin(components);
        if (kind === "no") continue;
        const { net } = computeScore(components);
        results.push({ placements, components, net, kind });
    }

    // Certain wins first, then likely, then by score descending within each.
    results.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "certain" ? -1 : 1;
        return b.net - a.net;
    });
    return results;
}

export default function BO7TotenreichReactorSolver({ title }: { title?: string }) {
    const [grid, setGrid] = useState<CellType[][]>(makeGrid);
    const [phase, setPhase] = useState<Phase>("setup");
    const [solutions, setSolutions] = useState<Solution[]>([]);
    const [solutionIndex, setSolutionIndex] = useState<number>(0);
    const [message, setMessage] = useState<string>(
        defaultMessage,
    );

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

    const formatMessage = (sols: Solution[], idx: number): string => {
        if (sols.length === 0) return "No solutions found. Check your rod placement matches the game.";
        const s = sols[idx];
        const tag = s.kind === "certain" ? "confirmed" : "likely";
        return `Solution ${idx + 1} of ${sols.length} — ${tag} (score ~${Math.round(s.net + 27)}px)`;
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
        if (phase === "results") {
            if (uraniumSet.has(key)) return "reactor-cell cell-uranium";
            if (grid[r][c] === "rod")
                return activated.has(key) ? "reactor-cell cell-activated" : "reactor-cell cell-rod";
            return "reactor-cell cell-empty";
        }
        return `reactor-cell ${grid[r][c] === "rod" ? "cell-rod" : "cell-empty"}`;
    };

    const renderGrid = () => {
        const cells = [];
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                cells.push(
                    <div key={`reactor-${r}-${c}`} className={getCellClass(r, c)} onClick={() => toggleCell(r, c)} />,
                );
            }
        }
        return cells;
    };

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">{message}</p>
            <div className="reactor-grid-wrapper">
                <div className="reactor-grid">{renderGrid()}</div>
            </div>
            {phase === "setup" ? (
                <div>
                    <button className="btn-base solver-button" onClick={handleSolve}>
                        Solve
                    </button>
                    <button className="btn-base solver-button" onClick={handleReset}>
                        Reset
                    </button>
                </div>
            ) : (
                <div>
                    {solutions.length > 1 && (
                        <>
                            <button className="btn-base solver-button" onClick={() => navigate(-1)}>
                                Prev
                            </button>
                            <button className="btn-base solver-button" onClick={() => navigate(1)}>
                                Next
                            </button>
                        </>
                    )}
                    <button className="btn-base solver-button" onClick={handleReset}>
                        Reset
                    </button>
                </div>
            )}
        </div>
    );
}