import { useMemo, useState } from "preact/hooks";

interface SamFile {
    file_number: number;
    name: string;
    date: string;
    chronological_order: number;
}

const SAM_FILES: SamFile[] = [
    { file_number: 6, name: "BND Badge", date: "6/28/1985", chronological_order: 1 },
    { file_number: 1, name: "Notso's Collar", date: "7/15/1985", chronological_order: 2 },
    { file_number: 3, name: "Scarf", date: "8/21/1985", chronological_order: 3 },
    { file_number: 4, name: "Wristwatch", date: "9/2/1985", chronological_order: 4 },
    { file_number: 5, name: "Combat Goggles", date: "10/12/1985", chronological_order: 5 },
    { file_number: 2, name: "Katana", date: "12/8/1985", chronological_order: 6 },
];

const fileByNumber = new Map(SAM_FILES.map((f) => [f.file_number, f]));

type CalcResult =
    | { kind: "ok"; code: string }
    | { kind: "incomplete"; remaining: number };

function calculateCode(picked: number[]): CalcResult {
    if (picked.length < 4) return { kind: "incomplete", remaining: 4 - picked.length };

    const files = picked
        .map((n) => fileByNumber.get(n))
        .filter((f): f is SamFile => f !== undefined)
        .sort((a, b) => a.chronological_order - b.chronological_order);

    return { kind: "ok", code: files.map((f) => f.file_number).join("") };
}

export default function BO6MaxisItemsSolver({ title }: { title?: string }) {
    // picked[i] = file_number assigned to slot i (the i-th in-game appearance).
    // Length grows from 0 to 4 as user clicks; clicking a slot removes that entry.
    const [picked, setPicked] = useState<number[]>([]);

    const result = useMemo(() => calculateCode(picked), [picked]);
    const recalcKey = picked.join(",");

    const togglePick = (fileNumber: number) => {
        const existingIndex = picked.indexOf(fileNumber);
        if (existingIndex >= 0) {
            // Already picked → remove from list
            const next = [...picked];
            next.splice(existingIndex, 1);
            setPicked(next);
            return;
        }
        if (picked.length >= 4) return;
        setPicked([...picked, fileNumber]);
    };

    const clearSlot = (slotIndex: number) => {
        if (slotIndex >= picked.length) return;
        const next = [...picked];
        next.splice(slotIndex, 1);
        setPicked(next);
    };

    const handleReset = () => {
        setPicked([]);
    };

    return (
        <div className="solver-container solver-container--maxis">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Click the 4 S.A.M. files that appear in-game. The solver will automatically sort them chronologically by date and show the code. Click a filled slot to remove that pick.
            </p>

            <div className="solver-text-picker" role="group" aria-label="S.A.M. file picker">
                {SAM_FILES.map((file) => {
                    const isPicked = picked.includes(file.file_number);
                    const atLimit = !isPicked && picked.length >= 4;
                    return (
                        <button
                            key={file.file_number}
                            type="button"
                            className={isPicked ? "is-selected" : ""}
                            disabled={atLimit}
                            aria-pressed={isPicked}
                            onClick={() => togglePick(file.file_number)}
                        >
                            {file.name}
                        </button>
                    );
                })}
            </div>

            <div className="solver-slot-list" role="list" aria-label="In-game order">
                {Array.from({ length: 4 }, (_, slotIndex) => {
                    const fileNumber = picked[slotIndex];
                    const file = fileNumber !== undefined ? fileByNumber.get(fileNumber) : undefined;
                    const filled = file !== undefined;
                    return (
                        <div
                            key={slotIndex}
                            role="listitem"
                            className={`solver-slot is-text${filled ? " is-filled" : ""}`}
                            onClick={() => clearSlot(slotIndex)}
                            aria-label={
                                filled
                                    ? `Position ${slotIndex + 1}: ${file.name}, click to remove`
                                    : `Position ${slotIndex + 1}: empty`
                            }
                        >
                            <span className="solver-slot__label">{slotIndex + 1}.</span>
                            {filled ? (
                                <span className="solver-slot__text">{file.name}</span>
                            ) : (
                                <span className="solver-slot__placeholder">empty</span>
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
                ) : (
                    <p style={{ color: "var(--color-text-muted)" }}>
                        Pick {result.remaining} more file{result.remaining !== 1 ? "s" : ""}.
                    </p>
                )}
            </div>
        </div>
    );
}