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

    return (
        <div className="solver-container solver-container--mahjong">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click every tile you can see in-game, including the ones lying around the map. A valid hand is 4 melds + 1 pair (14 tiles total). A meld is three of a kind or three consecutive (e.g. 3-3-3 or 3-4-5). Some pick-up tiles are decoys, so if you enter more than 14 the solver tells you which to leave out. Click a placed tile to remove it.
            </p>

            <div className="solver-symbol-select" role="group" aria-label="Mahjong tile picker">
                {TILE_VALUES.map((value) => {
                    const handFull = selectedValues.length >= MAX_TILES;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => handleTileClick(value)}
                            disabled={handFull}
                            aria-label={`${value} Dot tile`}
                        >
                            <img loading="lazy" src={tileImages[value]} alt="" />
                        </button>
                    );
                })}
            </div>

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output" aria-live="polite">
                {handResult ? (
                    <>
                        <p><strong>Winning hand</strong> - arrange your tiles in this order:</p>
                        <div className="mahjong-hand">
                            {handResult.melds.map((meld, mi) => (
                                <div key={`meld-${mi}`} className="mahjong-meld">
                                    {meld.map((value, ti) => (
                                        <img loading="lazy"
                                            key={ti}
                                            className="mahjong-tile"
                                            src={tileImages[value]}
                                            alt={`${value} Dot`}
                                        />
                                    ))}
                                </div>
                            ))}
                            <div className="mahjong-meld is-pair">
                                {handResult.pair.map((value, ti) => (
                                    <img loading="lazy"
                                        key={ti}
                                        className="mahjong-tile"
                                        src={tileImages[value]}
                                        alt={`${value} Dot`}
                                    />
                                ))}
                            </div>
                        </div>
                        {handResult.unused.length > 0 && (
                            <>
                                <p>Leave these out:</p>
                                <div className="mahjong-progress-row">
                                    {handResult.unused.map((value, ti) => (
                                        <img loading="lazy"
                                            key={ti}
                                            className="mahjong-tile"
                                            src={tileImages[value]}
                                            alt={`${value} Dot`}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    <>
                        <p>
                            {isComplete
                                ? <strong className="solver-error">No valid arrangement of 4 melds + 1 pair in these tiles.</strong>
                                : <>Selected tiles ({selectedValues.length}/14):</>}
                        </p>
                        <div className="mahjong-progress-row">
                            {Array.from({ length: slotCount }, (_, index) =>
                                selectedValues[index] !== undefined ? (
                                    <img loading="lazy"
                                        key={index}
                                        className="mahjong-tile"
                                        src={tileImages[selectedValues[index]]}
                                        alt={`${selectedValues[index]} Dot, click to remove`}
                                        onClick={() => handleTileRemove(index)}
                                    />
                                ) : (
                                    <div key={index} className="mahjong-tile-empty" aria-hidden="true" />
                                ),
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}