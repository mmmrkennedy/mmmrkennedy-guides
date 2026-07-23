import { useState } from "preact/hooks";

const imagePath = "/games/IW/the_beast_from_beyond/floppy_disk_puzzle/pictures/";

function processSymbols(symbols: number[]): number[] {
    // The numbers indicate the corresponding file name number
    const lines = [
        [1, 2, 3, 4, 0, 5],
        [6, 5, 8, 9, 7, 1],
        [9, 10, 7, 8, 6, 1],
        [9, 4, 3, 0, 5, 2],
        [1, 11, 3, 2, 0, 5],
        [4, 11, 0, 2, 5, 8],
    ];

    for (const line of lines) {
        if (symbols.every((n) => line.includes(n))) {
            return line.filter((n) => symbols.includes(n));
        }
    }

    return [];
}

export default function IWBeastFloppySolver({ title }: { title?: string }) {
    const [selectedSymbols, setSelectedSymbols] = useState<number[]>([]);
    const maxSymbols = 4;
    const totalSymbols = 12;

    const toggleSymbol = (symbolId: number) => {
        if (selectedSymbols.includes(symbolId)) {
            // Allow deselecting by clicking again
            setSelectedSymbols(selectedSymbols.filter((id) => id !== symbolId));
        } else if (selectedSymbols.length < maxSymbols) {
            setSelectedSymbols([...selectedSymbols, symbolId]);
        }
    };

    const resetAll = () => {
        setSelectedSymbols([]);
    };

    const isComplete = selectedSymbols.length === maxSymbols;
    const hasDuplicates = isComplete && new Set(selectedSymbols).size !== selectedSymbols.length;
    const resultImages = isComplete && !hasDuplicates ? processSymbols(selectedSymbols) : [];
    const isValid = isComplete && !hasDuplicates && resultImages.length > 0;

    const getMessage = (): string => {
        if (!isComplete) {
            const remaining = maxSymbols - selectedSymbols.length;
            return `Select ${remaining} more symbol${remaining !== 1 ? "s" : ""}.`;
        }
        if (hasDuplicates) return "Invalid: duplicate symbol selected.";
        if (!isValid) return "Invalid: no matching sequence found.";
        // return "Valid sequence — press the symbols in this order:";
        return "";
    };

    return (
        <div className="solver-container solver-container--floppy">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click the 4 symbols that appear in your game in any order. The solver will show the correct order if avaliable. Click a selected symbol to deselect it.
            </p>

            <div className="solver-symbol-select is-grid" role="group" aria-label="Symbol picker">
                {Array.from({ length: totalSymbols }, (_, i) => {
                    const isSelected = selectedSymbols.includes(i);
                    const atLimit = !isSelected && selectedSymbols.length >= maxSymbols;
                    return (
                        <button
                            key={i}
                            type="button"
                            className={isSelected ? "is-selected" : ""}
                            disabled={atLimit}
                            aria-pressed={isSelected}
                            aria-label={`Symbol ${i + 1}`}
                            onClick={() => toggleSymbol(i)}
                        >
                            <img src={`${imagePath}picture_${i}.webp`} alt="" />
                        </button>
                    );
                })}
            </div>

            <div className="solver-output">
                <p style={{ margin: 0 }}>{getMessage()}</p>
                {resultImages.length > 0 && (
                    <div className="solver-image-row" style={{ marginTop: "var(--space-sm)" }}>
                        {resultImages.map((id, idx) => (
                            <img
                                key={`${id}-${idx}`}
                                src={`${imagePath}picture_${id}.webp`}
                                alt={`Symbol ${id + 1}, position ${idx + 1}`}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="solver-controls">
                <button className="btn btn--solver" onClick={resetAll}>Reset</button>
            </div>
        </div>
    );
}