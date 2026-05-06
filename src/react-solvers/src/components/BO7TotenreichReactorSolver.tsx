import { useState } from "preact/hooks";
import type { JSX } from "preact";

type CellType = "empty" | "rod";
type Phase = "setup" | "results";
type Confidence = "high" | "med" | "low";

const defaultMessage = "Experimental! Scoring is still being reverse-engineered. Solutions are ranked by confidence (High > Med > Low). Try High first, but Med and Low may also work. Message \"Mark\" on the discord if you find an incorrect solution. Click cells to place control rods, then click Solve.";

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
// Bonus: when all 3 U's share a single component, that component would get +f(n)/4.
// (The bonus is computed for debug visibility only — the game does not appear to
// apply it. Net score returned excludes the bonus.)
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
            // Bonus disabled — game does not appear to apply +f(n)/4 for all-3-clustered.
            // Computed for debug visibility only.
            bonus += baseScore(c.size) / 4;
        }
    }

    return { net: netNoBonus, netNoBonus, bonus };
}

// Keep any solution whose score lands within the observed-or-plausible win range.
// Discarded scores: confirmed fails at raw 395 and raw 538 set the outer bounds.
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

// Confidence tiers calibrated against observed data.
// Raw score = net + 27.
//
// Confirmed wins:    raw 410 (min visual), 432, 462 (max visual)
// Confirmed fails:   raw 395 (big miss), raw 538 (wrong)
// Visual oddity:     raw 512 lands at the same visual spot as 410 — possibly a
//                    second valid window, but not confirmed as an actual win.
//
// High:  raw 410–462 (net 383–435) — full confirmed-win range, no buffer.
// Med:   raw 463–475 (net 436–448) — narrow buffer above max confirmed win.
// Low:   raw 476–530 (net 449–503) — covers the suspicious 512 visual match
//                                    but stops before the confirmed 538 fail.
const HIGH_NET_MIN = 383;
const HIGH_NET_MAX = 435;
const MED_NET_MIN = 436;
const MED_NET_MAX = 448;
const LOW_NET_MIN = 449;
const LOW_NET_MAX = 503;

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

    // Sort by confidence first (high > med > low), then by score descending within each tier.
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
    const [message, setMessage] = useState<string | JSX.Element>(
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

    const formatMessage = (sols: Solution[], idx: number): string | JSX.Element => {
        if (sols.length === 0) return "No solutions found. Check your rod placement matches the game.";
        const s = sols[idx];
        const colors: Record<Confidence, string> = {
            high: "#2ecc40",
            med: "#ff851b",
            low: "#ff4136",
        };
        const labels: Record<Confidence, string> = {
            high: "High",
            med: "Med",
            low: "Low",
        };
        const score = Math.round(s.netNoBonus);
        return (
            <>
                Solution {idx + 1} of {sols.length} — Confidence:{" "} <span style={{ color: colors[s.confidence], fontWeight: "bold" }}>
                    {labels[s.confidence]}
                </span> {" "}— Score: {score}
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

    const renderDebugPanel = () => {
        if (!debug) return null;
        const sol = solutions[solutionIndex];
        if (!sol) {
            return (
                <div className="solver-debug-panel" style={{
                    marginTop: "1rem",
                    padding: "0.75rem",
                    border: "1px dashed #888",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    whiteSpace: "pre-wrap",
                }}>
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
            <div className="solver-debug-panel" style={{
                marginTop: "1rem",
                padding: "0.75rem",
                border: "1px dashed #888",
                borderRadius: "4px",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                whiteSpace: "pre-wrap",
                textAlign: "left",
            }}>
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
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}<p className="solver-instructions">{message}</p>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem" }}> <input type="checkbox" checked={debug} onChange={(e) => setDebug((e.target as HTMLInputElement).checked)} style={{ marginRight: "0.4rem" }} /> Debug mode </label>
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
            )} {renderDebugPanel()}
        </div>
    );
}