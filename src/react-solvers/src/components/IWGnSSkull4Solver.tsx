import { useState, useMemo } from "preact/hooks";

const ALPHABET: string[] = "abcdefghijklmnopqrstuvwxyz".split("");

const VALID_WORDS: string[] = [
    "aldehydes",
    "allomer",
    "benzene",
    "chlorination",
    "ethers",
    "ethyl",
    "hydrogenation",
    "neutrino",
    "nitriles",
    "oxidation",
    "reduction",
    "solvolysis",
    "sublimation",
    "zwitterion",
];

const SYMBOL_PATH = "/games/IW/wyler_language_symbols/";

function letterToNumber(letter: string): number {
    return letter.charCodeAt(0) - "a".charCodeAt(0) + 1;
}

function wordToNumbers(word: string): number[] {
    return word.split("").map(letterToNumber);
}

function generateCombinations() {
    const combos = [];
    for (let firstPosition = 1; firstPosition <= 4; firstPosition++) {
        for (let secondPosition = 0; secondPosition <= 4; secondPosition++) {
            for (let thirdPosition = 0; thirdPosition <= 4; thirdPosition++) {
                for (let fourthPosition = 0; fourthPosition <= 4; fourthPosition++) {
                    if (isValidCombination(secondPosition, thirdPosition, fourthPosition)) {
                        combos.push([firstPosition, secondPosition, thirdPosition, fourthPosition]);
                    }
                }
            }
        }
    }
    return combos;
}

function isValidCombination(second: number, third: number, fourth: number) {
    return !((second === 0 && (third !== 0 || fourth !== 0)) || (third === 0 && fourth !== 0));
}

function calculateSequenceModulo(
    first: number,
    second: number,
    third: number,
    fourth: number,
    letterValues: number[],
): number {
    const valueOne = letterValues[first];
    const valueTwo = 3 * second + letterValues[second];
    const valueThree = 3 * third * 2 + letterValues[third];
    const valueFour = 3 * fourth * 3 + letterValues[fourth];
    return (valueOne + valueTwo + valueThree + valueFour) % 26;
}

function generateSequenceId(first: number, second: number, third: number, fourth: number): number {
    if (fourth !== 0) return 1000 * first + 100 * second + 10 * third + fourth;
    if (third !== 0) return 100 * first + 10 * second + third;
    if (second !== 0) return 10 * first + second;
    return first;
}

type SolveResult =
    | { kind: "ok"; code: string }
    | { kind: "incomplete"; reason: string }
    | { kind: "error"; reason: string };

function solveCipher(targetWord: string, swingsetLettersArr: string[]): SolveResult {
    const filledCount = swingsetLettersArr.filter((s) => s !== "").length;

    if (!targetWord) {
        return { kind: "incomplete", reason: "Choose a word and 4 symbols to see the code." };
    }
    if (filledCount < 4) {
        const remaining = 4 - filledCount;
        return { kind: "incomplete", reason: `Select ${remaining} more symbol${remaining !== 1 ? "s" : ""}.` };
    }
    if (!VALID_WORDS.includes(targetWord.toLowerCase())) {
        return { kind: "error", reason: "Invalid word." };
    }

    try {
        const letterValues = [0].concat(swingsetLettersArr.join("").toLowerCase().split("").map(letterToNumber));
        const targetWordValues = wordToNumbers(targetWord.toLowerCase());

        const shortestSequences = Array(targetWordValues.length).fill(Infinity);

        for (const [first, second, third, fourth] of generateCombinations()) {
            const sequenceModulo = calculateSequenceModulo(first, second, third, fourth, letterValues);
            const sequenceId = generateSequenceId(first, second, third, fourth);

            for (let index = 0; index < targetWordValues.length; index++) {
                if (sequenceModulo === targetWordValues[index] && sequenceId < shortestSequences[index]) {
                    shortestSequences[index] = sequenceId;
                }
            }
        }

        const code = shortestSequences
            .filter((seq) => seq !== Infinity)
            .map((seq) => String(seq))
            .join(" - ");

        if (!code) return { kind: "error", reason: "No valid sequence found." };
        return { kind: "ok", code };
    } catch {
        return { kind: "error", reason: "Input contains invalid characters." };
    }
}

export default function IWGnSSkull4Solver({ title }: { title?: string }) {
    const [word, setWord] = useState<string>("");
    const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["", "", "", ""]);

    // Auto-derived from inputs — no useEffect / extra state.
    // The freshness animation is keyed by these inputs so the result
    // re-renders cleanly whenever the user changes something.
    const result = useMemo(() => solveCipher(word, selectedSymbols), [word, selectedSymbols]);
    const recalcKey = `${word}|${selectedSymbols.join(",")}`;

    const handleSymbolClick = (letter: string) => {
        if (selectedSymbols.includes(letter)) return;
        const emptyIndex = selectedSymbols.findIndex((s) => s === "");
        if (emptyIndex !== -1) {
            const next = [...selectedSymbols];
            next[emptyIndex] = letter;
            setSelectedSymbols(next);
        }
    };

    const handleClearSlot = (index: number) => {
        if (!selectedSymbols[index]) return;
        const next = [...selectedSymbols];
        next[index] = "";
        setSelectedSymbols(next);
    };

    const handleReset = () => {
        setWord("");
        setSelectedSymbols(["", "", "", ""]);
    };

    const filledCount = selectedSymbols.filter((s) => s !== "").length;
    const isFull = filledCount >= 4;

    return (
        <div className="solver-container solver-container--skull4">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Choose the target word, then click the 4 symbols matching the swingset symbols in your game. The solution will be shown automatically. Click a filled slot to clear it.
            </p>

            <div className="solver-form-row">
                <label htmlFor="skull4-word">Target word:</label>
                <select
                    id="skull4-word"
                    value={word}
                    onChange={(e) => setWord((e.target as HTMLSelectElement).value)}
                >
                    <option value="">Choose a word…</option>
                    {VALID_WORDS.map((w) => (
                        <option key={w} value={w}>{w}</option>
                    ))}
                </select>
            </div>

            <div className="solver-slot-list" role="list" aria-label="Selected symbols">
                {selectedSymbols.map((symbol, index) => {
                    const filled = symbol !== "";
                    return (
                        <div
                            key={index}
                            role="listitem"
                            className={`solver-slot${filled ? " is-filled" : ""}`}
                            onClick={() => handleClearSlot(index)}
                            aria-label={filled ? `Slot ${index + 1}: ${symbol.toUpperCase()}, click to clear` : `Slot ${index + 1}: empty`}
                        >
                            {filled ? (
                                <>
                                    <span className="solver-slot__label">{symbol.toUpperCase()}</span>
                                    <img loading="lazy"
                                        className="solver-slot__image"
                                        src={`${SYMBOL_PATH}${symbol}.webp`}
                                        alt=""
                                    />
                                </>
                            ) : (
                                <span className="solver-slot__placeholder">{index + 1}</span>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="solver-letter-grid" role="group" aria-label="Symbol picker">
                {ALPHABET.map((letter) => {
                    const isSelected = selectedSymbols.includes(letter);
                    const isDisabled = !isSelected && isFull;
                    return (
                        <button
                            key={letter}
                            type="button"
                            className={`solver-letter-cell${isSelected ? " is-selected" : ""}`}
                            disabled={isSelected || isDisabled}
                            aria-pressed={isSelected}
                            onClick={() => handleSymbolClick(letter)}
                        >
                            <span className="solver-letter-cell__letter">{letter.toUpperCase()}</span>
                            <img loading="lazy"
                                className="solver-letter-cell__image"
                                src={`${SYMBOL_PATH}${letter}.webp`}
                                alt=""
                            />
                        </button>
                    );
                })}
            </div>

            <div className="solver-controls">
                <button className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output is-recalc" key={recalcKey} aria-live="polite">
                {result.kind === "ok" ? (
                    <p style={{ margin: 0 }}>
                        <strong>Code:</strong> {result.code}
                    </p>
                ) : result.kind === "error" ? (
                    <p className="solver-error" style={{ margin: 0 }}>{result.reason}</p>
                ) : (
                    <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{result.reason}</p>
                )}
            </div>
        </div>
    );
}