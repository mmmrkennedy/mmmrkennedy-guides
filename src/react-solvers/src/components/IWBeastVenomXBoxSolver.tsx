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

// Helper functions converted from venom_x_box.js
function calcS(arr: Color[]): number {
    return new Set(arr).size;
}

function BL(arr: Color[], colour: Color): number {
    let index = 0;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] === colour) {
            index = i;
        }
    }
    return index + 1;
}

function isAnyEven(arr: number[]): boolean {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] % 2 === 0 && arr[i] !== 0) {
            return true;
        }
    }
    return false;
}

function areAllLessThanEqual(arr: number[], num: number): boolean {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > num) {
            return false;
        }
    }
    return true;
}

function processArr(buttonArr: Color[]): { counts: ColorCounts; S: number; W: number[]; X: number } {
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

    const S = calcS(buttonArr);
    const W = [counts.red, counts.green, counts.blue, counts.black, counts.yellow, counts.white];

    return { counts, S, W, X };
}

function venomBoxCalc(buttonArr: Color[]): string {
    const { counts, S, W, X } = processArr(buttonArr);

    if (X === 3) {
        if (counts.black === 0) return "Button #3";
        if (buttonArr[X - 1] === "green") return "Button #1";
        if (counts.red > 1) return `Button #${BL(buttonArr, "red")}`;
        return "Button #2";
    } else if (X === 4) {
        if (counts.yellow > 1 && S >= 2) return `Button #${BL(buttonArr, "yellow")}`;
        if (buttonArr[X - 1] === "white" && counts.blue === 0) return "Button #1";
        if (counts.black > 1) return `Button #${X}`;
        return "Button #3";
    } else if (X === 5) {
        if (areAllLessThanEqual(W, 3)) return "Button #1";
        if (counts.white === 1 && counts.blue > 1) return "Button #2";
        if (counts.red === 0 && isAnyEven(W) && S < 4) return "Button #5";
        return "Button #1";
    } else if (X === 6) {
        if (counts.yellow !== 0) return "Button #3";
        if (counts.black === 1 && counts.white > 1) return "Button #4";
        if (S >= 1 && counts.red > 1) return "Button #5";
        return "Button #6";
    }

    return "";
}

export default function IWBeastVenomXBoxSolver({ title }: { title?: string }) {
    const [buttonCount, setButtonCount] = useState<ButtonCount>(3);
    const [selectedColors, setSelectedColors] = useState<Color[]>(["red", "red", "red"]);
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

    const result = selectedColors.length === buttonCount ? venomBoxCalc(selectedColors) : "";
    const solutionButtonIndex = result ? (parseInt(result.match(/#(\d+)/)?.[1] ?? "0") - 1) : -1;
    const resultColor = solutionButtonIndex >= 0 ? COLOR_HEX[selectedColors[solutionButtonIndex]] : undefined;

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Select the number of buttons, then tap the color matching each button in-game (top to bottom). The
                solution will appear below.
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

            <div className="solver-output">
                <p
                    key={calcKeyRef.current}
                    className="is-recalc"
                    style={resultColor ? { color: resultColor, margin: 0 } : { margin: 0 }}
                >
                    Press {result}
                </p>
            </div>
        </div>
    );
}