import { useMemo, useState } from "preact/hooks";

type Word = "CRAB" | "MOTH" | "WORM" | "YETI";
type BoardId = 0 | 1 | 2 | 3;

const WORDS: Word[] = ["CRAB", "MOTH", "WORM", "YETI"];

interface BoardOption {
    id: BoardId;
    bottomLeft: string;
    groups: string[];
}

const BOARDS: BoardOption[] = [
    { id: 0, bottomLeft: "NI", groups: ["OSTUHJLD", "QPGAFR", "YZKWX", "NI", "ECVB", "M"] },
    { id: 1, bottomLeft: "OUY", groups: ["E", "BCDSTVWXZ", "KLMNPQR", "OUY", "FGHJ", "AI"] },
    { id: 2, bottomLeft: "S", groups: ["AIOUY", "QX", "BCDEFGH", "S", "LMNPRTVW", "JKZ"] },
    { id: 3, bottomLeft: "M", groups: ["BCDEF", "XYZ", "GHILNO", "M", "JKQU", "APRSTVW"] },
];

type CalcResult =
    | { kind: "ok"; code: string }
    | { kind: "incomplete" }
    | { kind: "error"; reason: string };

function calculateCode(word: Word | null, boardId: BoardId | null): CalcResult {
    if (word === null || boardId === null) return { kind: "incomplete" };

    const board = BOARDS[boardId];
    let digits = "";

    for (const letter of word) {
        const group = board.groups.find((g) => g.toUpperCase().includes(letter.toUpperCase()));
        if (!group) {
            return {
                kind: "error",
                reason: `Letter "${letter}" isn't on this board - check your board choice.`,
            };
        }
        digits += String(group.length);
    }

    if (digits.length !== 4) {
        return { kind: "error", reason: "Couldn't calculate a 4-digit code. Double-check your selections." };
    }

    return { kind: "ok", code: digits };
}

export default function BO6LetterboardSolver({ title }: { title?: string }) {
    const [word, setWord] = useState<Word | null>(null);
    const [boardId, setBoardId] = useState<BoardId | null>(null);

    const result = useMemo(() => calculateCode(word, boardId), [word, boardId]);
    const recalcKey = `${word}|${boardId}`;

    return (
        <div className="solver-container solver-container--letterboard">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Pick the word from the fax machine paper and the letter(s) you see in the bottom-left corner of the chalkboard. The code will appear automatically.
            </p>

            <div className="solver-form-row">
                <label htmlFor="lb-word">Word:</label>
                <select
                    id="lb-word"
                    value={word ?? ""}
                    onChange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        setWord(v === "" ? null : (v as Word));
                    }}
                >
                    <option value="" disabled>Choose a word…</option>
                    {WORDS.map((w) => (
                        <option key={w} value={w}>{w}</option>
                    ))}
                </select>
            </div>

            <div className="solver-form-row">
                <label htmlFor="lb-board">Bottom-left letter(s):</label>
                <select
                    id="lb-board"
                    value={boardId ?? ""}
                    onChange={(e) => {
                        const v = (e.currentTarget as HTMLSelectElement).value;
                        setBoardId(v === "" ? null : (Number(v) as BoardId));
                    }}
                >
                    <option value="" disabled>Choose your letters…</option>
                    {BOARDS.map((b) => (
                        <option key={b.id} value={b.id}>{b.bottomLeft}</option>
                    ))}
                </select>
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
                        Pick a word and a board to see the code.
                    </p>
                )}
            </div>
        </div>
    );
}