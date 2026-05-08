import { useState } from "preact/hooks";

interface HandResult {
    isWinning: boolean;
    melds: number[][];
    pair: number[] | null;
}

const TILE_VALUES = [1, 2, 3, 4, 5] as const;

const tileImages: Record<number, string> = {
    1: "/games/IW/shaolin_shuffle/mahjong_solver/dot_1.webp",
    2: "/games/IW/shaolin_shuffle/mahjong_solver/dot_2.webp",
    3: "/games/IW/shaolin_shuffle/mahjong_solver/dot_3.webp",
    4: "/games/IW/shaolin_shuffle/mahjong_solver/dot_4.webp",
    5: "/games/IW/shaolin_shuffle/mahjong_solver/dot_5.webp",
};

function calculateHand(selectedValues: number[]): HandResult {
    // Count occurrences of each tile value
    const tileCounts: Record<number, number> = {};
    selectedValues.forEach((v) => {
        tileCounts[v] = (tileCounts[v] || 0) + 1;
    });

    const melds: number[][] = [];
    let pair: number[] | null = null;

    // Triplets first
    Object.entries(tileCounts).forEach(([value, count]) => {
        const numValue = Number(value);
        if (count >= 3) {
            melds.push([numValue, numValue, numValue]);
            tileCounts[numValue] -= 3;
        }
        if (tileCounts[numValue] === 2 && !pair) {
            pair = [numValue, numValue];
            tileCounts[numValue] -= 2;
        }
    });

    // Sequences
    const sortedValues = Object.keys(tileCounts).map(Number).sort((a, b) => a - b);

    for (let i = 0; i < sortedValues.length - 2; i++) {
        const [a, b, c] = [sortedValues[i], sortedValues[i + 1], sortedValues[i + 2]];
        if (b - a === 1 && c - b === 1 && tileCounts[a] > 0 && tileCounts[b] > 0 && tileCounts[c] > 0) {
            melds.push([a, b, c]);
            tileCounts[a]--;
            tileCounts[b]--;
            tileCounts[c]--;
        }
    }

    return {
        isWinning: melds.length >= 4 && pair !== null,
        melds,
        pair,
    };
}

export default function IWMahjongSolver({ title }: { title?: string }) {
    const [selectedValues, setSelectedValues] = useState<number[]>([]);

    const getTileCount = (value: number): number => selectedValues.filter((v) => v === value).length;

    const handleTileClick = (value: number) => {
        if (selectedValues.length >= 14) return;
        if (getTileCount(value) >= 4) return;
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

    const handResult = selectedValues.length === 14 ? calculateHand(selectedValues) : null;
    const isComplete = selectedValues.length === 14;

    return (
        <div className="solver-container solver-container--mahjong">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click tiles as they appear in-game. A valid hand is 4 melds + 1 pair (14 tiles total). A meld is three
                of a kind or three consecutive (e.g. 3-3-3 or 3-4-5). Click a placed tile to remove it.
            </p>

            <div className="solver-symbol-select" role="group" aria-label="Mahjong tile picker">
                {TILE_VALUES.map((value) => {
                    const atLimit = getTileCount(value) >= 4;
                    const handFull = selectedValues.length >= 14;
                    return (
                        <button
                            key={value}
                            type="button"
                            onClick={() => handleTileClick(value)}
                            disabled={atLimit || handFull}
                            aria-label={`${value} Dot tile${atLimit ? " (max selected)" : ""}`}
                        >
                            <img src={tileImages[value]} alt="" />
                        </button>
                    );
                })}
            </div>

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output" aria-live="polite">
                {handResult?.isWinning ? (
                    <>
                        <p><strong>Winning hand</strong> — arrange your tiles in this order:</p>
                        <div className="mahjong-hand">
                            {handResult.melds.map((meld, mi) => (
                                <div key={`meld-${mi}`} className="mahjong-meld">
                                    {meld.map((value, ti) => (
                                        <img
                                            key={ti}
                                            className="mahjong-tile"
                                            src={tileImages[value]}
                                            alt={`${value} Dot`}
                                        />
                                    ))}
                                </div>
                            ))}
                            {handResult.pair && (
                                <div className="mahjong-meld is-pair">
                                    {handResult.pair.map((value, ti) => (
                                        <img
                                            key={ti}
                                            className="mahjong-tile"
                                            src={tileImages[value]}
                                            alt={`${value} Dot`}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <p>
                            {isComplete && handResult && !handResult.isWinning
                                ? <strong className="solver-error">Invalid hand — no valid arrangement of 4 melds + 1 pair.</strong>
                                : <>Selected tiles ({selectedValues.length}/14):</>}
                        </p>
                        <div className="mahjong-progress-row">
                            {Array.from({ length: 14 }, (_, index) =>
                                selectedValues[index] !== undefined ? (
                                    <img
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