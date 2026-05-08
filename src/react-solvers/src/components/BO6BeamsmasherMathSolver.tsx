import { useMemo, useState } from "preact/hooks";

const SYMBOL_VALUES = [0, 10, 11, 20, 21, 22] as const;
type SymbolValue = (typeof SYMBOL_VALUES)[number];
type SlotKey = "X" | "Y" | "Z";

const IMAGE_PATH = "/games/BO6/terminus/pictures/beamsmasher/";

const imageFor = (value: SymbolValue): string => `${IMAGE_PATH}${value}.webp`;

interface Slots {
    X: SymbolValue | null;
    Y: SymbolValue | null;
    Z: SymbolValue | null;
}

const SLOT_KEYS: SlotKey[] = ["X", "Y", "Z"];

type CalcResult =
    | { kind: "ok"; code: string }
    | { kind: "incomplete"; remaining: number }
    | { kind: "error"; reason: string };

function calculate(slots: Slots): CalcResult {
    const filled = SLOT_KEYS.filter((k) => slots[k] !== null).length;
    if (filled < 3) {
        return { kind: "incomplete", remaining: 3 - filled };
    }

    const X = slots.X!;
    const Y = slots.Y!;
    const Z = slots.Z!;

    const f1 = 2 * X + 11;
    const f2 = 2 * Z + Y - 5;
    const f3 = Math.abs(Y + Z - X);

    if (f1 < 0 || f2 < 0 || f3 < 0) {
        return { kind: "error", reason: "Invalid selection — a formula returned a negative number." };
    }

    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return { kind: "ok", code: `${pad(f1)} – ${pad(f2)} – ${pad(f3)}` };
}

export default function BO6BeamsmasherMathSolver({ title }: { title?: string }) {
    const [slots, setSlots] = useState<Slots>({ X: null, Y: null, Z: null });

    const result = useMemo(() => calculate(slots), [slots]);
    const recalcKey = `${slots.X}|${slots.Y}|${slots.Z}`;

    /** Find which slot (if any) currently holds the given symbol. */
    const slotForValue = (value: SymbolValue): SlotKey | null => {
        for (const key of SLOT_KEYS) {
            if (slots[key] === value) return key;
        }
        return null;
    };

    /** Click a symbol in the picker: assign to next empty slot, or
     unassign if it's already assigned somewhere. */
    const toggleSymbol = (value: SymbolValue) => {
        const owner = slotForValue(value);
        if (owner) {
            setSlots({ ...slots, [owner]: null });
            return;
        }
        const nextEmpty = SLOT_KEYS.find((k) => slots[k] === null);
        if (!nextEmpty) return;
        setSlots({ ...slots, [nextEmpty]: value });
    };

    const clearSlot = (key: SlotKey) => {
        if (slots[key] === null) return;
        setSlots({ ...slots, [key]: null });
    };

    const handleReset = () => {
        setSlots({ X: null, Y: null, Z: null });
    };

    return (
        <div className="solver-container solver-container--beamsmasher">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click each symbol matching the sticky notes on the in-game computer. Symbols fill the X / Y / Z slots in
                order. Click a filled slot or its symbol again to clear it.
            </p>

            <div className="solver-symbol-select is-grid" role="group" aria-label="Symbol picker">
                {SYMBOL_VALUES.map((value) => {
                    const owner = slotForValue(value);
                    return (
                        <button
                            key={value}
                            type="button"
                            className={owner ? "is-selected" : ""}
                            aria-pressed={owner !== null}
                            aria-label={`Symbol ${value}${owner ? ` (assigned to ${owner})` : ""}`}
                            onClick={() => toggleSymbol(value)}
                        >
                            <img src={imageFor(value)} alt="" />
                        </button>
                    );
                })}
            </div>

            <div className="solver-slot-list" role="list" aria-label="X Y Z slots">
                {SLOT_KEYS.map((key) => {
                    const value = slots[key];
                    const filled = value !== null;
                    return (
                        <div
                            key={key}
                            role="listitem"
                            className={`solver-slot${filled ? " is-filled" : ""}`}
                            onClick={() => clearSlot(key)}
                            aria-label={
                                filled
                                    ? `${key}: symbol ${value}, click to clear`
                                    : `${key}: empty`
                            }
                        >
                            <span className="solver-slot__label">{key}</span>
                            {filled ? (
                                <img className="solver-slot__image" src={imageFor(value!)} alt="" />
                            ) : (
                                <span className="solver-slot__placeholder">?</span>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={handleReset}>Reset</button>
            </div>

            <div className="solver-output is-recalc" key={recalcKey} aria-live="polite">
                {result.kind === "ok" ? (
                    <p>
                        <strong>Code:</strong> {result.code}
                    </p>
                ) : result.kind === "error" ? (
                    <p className="solver-error">{result.reason}</p>
                ) : (
                    <p style={{ color: "var(--color-text-muted)" }}>
                        Select {result.remaining} more symbol{result.remaining !== 1 ? "s" : ""}.
                    </p>
                )}
            </div>
        </div>
    );
}