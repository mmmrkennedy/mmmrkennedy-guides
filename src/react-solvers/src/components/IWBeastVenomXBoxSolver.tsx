import { useState, useRef } from "preact/hooks";

// Type definitions
type Color = "red" | "green" | "blue" | "black" | "yellow" | "white";
type ButtonCount = 3 | 4 | 5 | 6;

interface ColorCounts {
    red: number;
    green: number;
    blue: number;
    black: number;
    yellow: number;
    white: number;
}

const COLORS: Color[] = ["red", "green", "blue", "black", "yellow", "white"];

// Used for the result text — needs to be readable on a dark panel,
// so 'black' is mapped to a light gray.
const COLOR_HEX: Record<Color, string> = {
    red:    "#e74c3c",
    green:  "#2ecc71",
    blue:   "#5dade2",
    black:  "#aaaaaa",
    yellow: "#f1c40f",
    white:  "#ecf0f1",
};

// Used for the swatch fills — closer to the actual in-game colors.
// 'black' is dark but not pure black so it's distinguishable from
// the panel and visible at low opacity when not selected.
const COLOR_SWATCH: Record<Color, string> = {
    red:    "#e74c3c",
    green:  "#2ecc71",
    blue:   "#5dade2",
    black:  "#3a3a3a",
    yellow: "#f1c40f",
    white:  "#ecf0f1",
};

// Helper functions converted from the game's validate_wire_logic().
// Two of the game's inputs are round state, not colours: W is the round
// you're on and S is the number of special rounds you've cleared. An
// earlier version of this solver guessed both from the colour list
// (distinct-colour count for S, the colour tallies for W), which is why
// it disagreed with the game on every box except X=3.

// The GSC scans the wires in reverse, so BL(r) is the bottom-most red
// button, not the first one found from the top.
function BL(arr: Color[], colour: Color): number {
    let index = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === colour) {
            index = i;
        }
    }
    return index + 1;
}

// S, straight out of update_special_round_counter(). The bands are
// exclusive on the low side — round 20 is the first that gives S = 4.
function specialRoundsFromRound(roundNum: number): number {
    if (roundNum > 19) return 4;
    if (roundNum > 14) return 3;
    if (roundNum > 9) return 2;
    if (roundNum > 4) return 1;
    return 0;
}

function processArr(buttonArr: Color[]): { counts: ColorCounts; X: number } {
    const counts: ColorCounts = {
        red: 0,
        green: 0,
        blue: 0,
        black: 0,
        yellow: 0,
        white: 0,
    };

    const X = buttonArr.length;

    for (let i = 0; i < X; i++) {
        const color = buttonArr[i].toLowerCase() as Color;
        counts[color]++;
    }

    return { counts, X };
}

function venomBoxCalc(buttonArr: Color[], roundNum: number): string {
    const { counts, X } = processArr(buttonArr);
    const last = buttonArr[X - 1];
    const S = specialRoundsFromRound(roundNum);

    if (X === 3) {
        if (counts.black === 0) return "Button #3";
        if (last === "green") return "Button #1";
        if (counts.red > 1) return `Button #${BL(buttonArr, "red")}`;
        return "Button #2";
    } else if (X === 4) {
        if (counts.yellow > 1 && S >= 2) return `Button #${BL(buttonArr, "yellow")}`;
        if (last === "white" && counts.blue === 0) return "Button #1";
        if (counts.black > 1) return `Button #${X}`;
        return "Button #3";
    } else if (X === 5) {
        if (roundNum <= 3) return "Button #1";
        if (counts.white === 1 && counts.blue > 1) return "Button #2";
        if (counts.red === 0 && roundNum % 2 === 0 && S < 4) return `Button #${X}`;
        return "Button #1";
    } else if (X === 6) {
        if (counts.yellow !== 0) return "Button #3";
        if (counts.black === 1 && counts.white > 1) return "Button #4";
        if (S >= 1 && counts.red > 1) return "Button #5";
        return `Button #${X}`;
    }

    return "";
}

export default function IWBeastVenomXBoxSolver({ title }: { title?: string }) {
    const [buttonCount, setButtonCount] = useState<ButtonCount>(3);
    const [selectedColors, setSelectedColors] = useState<Color[]>(["red", "red", "red"]);
    // 0 means the round field is empty. Left blank rather than defaulted to 1:
    // a wrong-but-plausible default would quietly hand out wrong answers to
    // anyone who doesn't notice the field.
    const [roundNum, setRoundNum] = useState<number>(0);
    const calcKeyRef = useRef(0);

    const handleButtonCountChange = (e: Event) => {
        const newCount = parseInt((e.currentTarget as HTMLSelectElement).value) as ButtonCount;
        setButtonCount(newCount);
        const initialColors = Array(newCount).fill("red") as Color[];
        setSelectedColors(initialColors);
        calcKeyRef.current++;
    };

    const handleColorChange = (slotIndex: number, color: Color) => {
        const newColors = [...selectedColors];
        newColors[slotIndex] = color;
        setSelectedColors(newColors);
        calcKeyRef.current++;
    };

    const handleRoundChange = (e: Event) => {
        const raw = parseInt((e.currentTarget as HTMLInputElement).value, 10);
        setRoundNum(Number.isNaN(raw) || raw < 1 ? 0 : raw);
        calcKeyRef.current++;
    };

    // The X=3 box is the only one that never reads the round, so it stays
    // solvable while the field is blank.
    const hasRound = roundNum >= 1 || buttonCount === 3;
    const result = selectedColors.length === buttonCount && hasRound
        ? venomBoxCalc(selectedColors, roundNum)
        : "";
    const solutionButtonIndex = result ? (parseInt(result.match(/#(\d+)/)?.[1] ?? "0") - 1) : -1;
    const resultColor = solutionButtonIndex >= 0 ? COLOR_HEX[selectedColors[solutionButtonIndex]] : undefined;

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Select the number of buttons and your current round, then tap the color matching each button in-game (top to bottom). Every box except the 3-button one changes with the round, so it has to be right.
            </p>
            <p className="note">
                The game tracks one of its own variables incorrectly (found after looking at the code), so the solver can occasionally tell you the wrong button. That&apos;s just a bug in the game, and not something I can build around. Sorry.
            </p>

            <div className="solver-form-row">
                <label htmlFor="venom-x-box-count">Number of buttons:</label>
                <select
                    id="venom-x-box-count"
                    value={buttonCount}
                    onChange={handleButtonCountChange}
                >
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                </select>
            </div>

            <div className="solver-form-row">
                <label htmlFor="venom-x-box-round">Current Round:</label>
                <input
                    type="text"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    id="venom-x-box-round"
                    value={roundNum || ""}
                    onInput={handleRoundChange}
                    placeholder="e.g. 12"
                    autocomplete="off"
                />
            </div>

            <div className="solver-stack">
                {Array.from({ length: buttonCount }, (_, i) => (
                    <div className="solver-slot-row" key={i}>
                        <span className="solver-slot-row__label">Button {i + 1}</span>
                        <div className="solver-swatch-row" role="radiogroup" aria-label={`Button ${i + 1} color`}>
                            {COLORS.map((color) => {
                                const isSelected = selectedColors[i] === color;
                                return (
                                    <button
                                        key={color}
                                        type="button"
                                        role="radio"
                                        aria-checked={isSelected}
                                        aria-label={color}
                                        className={`solver-color-swatch${isSelected ? " is-selected" : ""}`}
                                        style={{ "--swatch-color": COLOR_SWATCH[color] } as preact.JSX.CSSProperties}
                                        onClick={() => handleColorChange(i, color)}
                                    />
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="solver-output is-recalc" key={calcKeyRef.current} aria-live="polite">
                <p style={resultColor ? { color: resultColor } : undefined}>
                    {result ? `Press ${result}` : "Enter your current round to solve the box"}
                </p>
            </div>
        </div>
    );
}