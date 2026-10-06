import { useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

interface HandResult {
    melds: number[][];
    pair: number[];
    unused: number[];
}

const TILE_VALUES = [1, 2, 3, 4, 5] as const;

// 14-tile hand plus up to 5 decoy pick-ups (2 + players - 1 in a 4-player game)
const MAX_TILES = 19;

const MELDS: number[][] = [
    ...TILE_VALUES.map((v) => [v, v, v]),
    [1, 2, 3],
    [2, 3, 4],
    [3, 4, 5],
];

const tileImages: Record<number, string> = {
    1: "/games/IW/shaolin_shuffle/mahjong_solver/dot_1.webp",
    2: "/games/IW/shaolin_shuffle/mahjong_solver/dot_2.webp",
    3: "/games/IW/shaolin_shuffle/mahjong_solver/dot_3.webp",
    4: "/games/IW/shaolin_shuffle/mahjong_solver/dot_4.webp",
    5: "/games/IW/shaolin_shuffle/mahjong_solver/dot_5.webp",
};

// Backtracking search for 4 melds + 1 pair out of the picked tiles. Any extra
// tiles are decoys and come back as `unused`.
function calculateHand(selectedValues: number[]): HandResult | null {
    const counts = [0, 0, 0, 0, 0, 0];
    selectedValues.forEach((v) => counts[v]++);

    const melds: number[][] = [];
    let pair: number[] | null = null;

    const search = (start: number): boolean => {
        if (melds.length === 4) {
            const pairValue = TILE_VALUES.find((v) => counts[v] >= 2);
            if (pairValue === undefined) return false;
            pair = [pairValue, pairValue];
            counts[pairValue] -= 2;
            return true;
        }
        for (let i = start; i < MELDS.length; i++) {
            const meld = MELDS[i];
            meld.forEach((v) => counts[v]--);
            if (meld.every((v) => counts[v] >= 0)) {
                melds.push(meld);
                if (search(i)) return true;
                melds.pop();
            }
            meld.forEach((v) => counts[v]++);
        }
        return false;
    };

    if (!search(0) || !pair) return null;
    const unused = TILE_VALUES.flatMap((v) => Array(counts[v]).fill(v));
    return { melds, pair, unused };
}

function Tile({ value }: { value: number }) {
    return <img loading="lazy" className="mahjong-tile" src={tileImages[value]} alt={`${value} Dot`} />;
}

function TileGroup({ label, values, variant }: { label: string; values: number[]; variant?: "pair" | "decoy" }) {
    return (
        <div className={`mahjong-group${variant ? ` is-${variant}` : ""}`}>
            <span className="mahjong-group__label">{label}</span>
            <div className="mahjong-group__tiles">
                {values.map((value, ti) => <Tile key={ti} value={value} />)}
            </div>
        </div>
    );
}

export default function IWMahjongSolver({ title }: { title?: string }) {
    const [selectedValues, setSelectedValues] = useState<number[]>([]);

    useSolverReport("MahjongSolver", () => ({
        "Tiles picked, in order": selectedValues,
    }));

    const handleTileClick = (value: number) => {
        if (selectedValues.length >= MAX_TILES) return;
        setSelectedValues([...selectedValues, value]);
    };

    const handleTileRemove = (index: number) => {
        const next = [...selectedValues];
        next.splice(index, 1);
        setSelectedValues(next);
    };

    const handleReset = () => {
        setSelectedValues([]);
    };

    const isComplete = selectedValues.length >= 14;
    const handResult = isComplete ? calculateHand(selectedValues) : null;
    const slotCount = Math.max(14, selectedValues.length);
    const handFull = selectedValues.length >= MAX_TILES;
    const tilesLeft = 14 - selectedValues.length;

    return (
        <div className="solver-container solver-container--mahjong">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Tap each tile you find, including the pick-ups around the map. Some pick-ups are decoys, so enter them all and the solver tells you which to leave out. Tap a placed tile to remove it.
            </p>

            <div className="solver-symbol-select" role="group" aria-label="Mahjong tile picker">
                {TILE_VALUES.map((value) => {
                    const count = selectedValues.filter((v) => v === value).length;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => handleTileClick(value)}
                            disabled={handFull}
                            aria-label={`Add ${value} Dot tile${count ? `, ${count} entered` : ""}`}
                        >
                            <img loading="lazy" src={tileImages[value]} alt="" />
                            {count > 0 && <span className="mahjong-picker-count" aria-hidden="true">{count}</span>}
                        </button>
                    );
                })}
            </div>

            <div className="mahjong-entered">
                <div className="mahjong-entered__header">
                    <span>Your tiles</span>
                    <span className="mahjong-entered__count">
                        {selectedValues.length}/14{selectedValues.length > 14 && ` (+${selectedValues.length - 14} extra)`}
                    </span>
                </div>
                <div className="mahjong-slots">
                    {Array.from({ length: slotCount }, (_, index) =>
                        selectedValues[index] !== undefined ? (
                            <button
                                key={index}
                                type="button"
                                className="mahjong-slot-btn"
                                onClick={() => handleTileRemove(index)}
                                aria-label={`${selectedValues[index]} Dot, tap to remove`}
                            >
                                <img loading="lazy" className="mahjong-tile" src={tileImages[selectedValues[index]]} alt="" />
                            </button>
                        ) : (
                            <div key={index} className="mahjong-tile-empty" aria-hidden="true" />
                        ),
                    )}
                </div>
            </div>

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output" aria-live="polite">
                {handResult ? (
                    <>
                        <p><strong>Winning hand.</strong> Place your tiles in this order:</p>
                        <div className="mahjong-hand">
                            {handResult.melds.map((meld, mi) => (
                                <TileGroup key={mi} label={`Set ${mi + 1}`} values={meld} />
                            ))}
                            <TileGroup label="Pair" values={handResult.pair} variant="pair" />
                        </div>
                        {handResult.unused.length > 0 && (
                            <div className="mahjong-hand">
                                <TileGroup label="Decoys, leave these out" values={handResult.unused} variant="decoy" />
                            </div>
                        )}
                    </>
                ) : isComplete ? (
                    <p><strong className="solver-error">No winning hand in these tiles.</strong> Check for a mis-tapped tile, or add any pick-ups you haven't entered yet.</p>
                ) : (
                    <p className="mahjong-waiting">
                        A winning hand is four sets of three (like 3-3-3 or 3-4-5) plus a pair. Add {tilesLeft} more tile{tilesLeft === 1 ? "" : "s"} to solve.
                    </p>
                )}
            </div>
        </div>
    );
}
