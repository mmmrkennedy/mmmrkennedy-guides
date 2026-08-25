import { useMemo, useRef, useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

/**
 * Generic simon-says recorder.
 *
 * The puzzle it serves: something in the map flashes a sequence, one item at a
 * time, and the reader has to play it back. Watching it and remembering it is
 * the whole difficulty, so this does not solve anything - it is somewhere to
 * put each flash the moment it happens, and it reads the order back.
 *
 * Nothing here is map-specific on purpose. A page supplies the palette in its
 * mount call and gets one pad per colour:
 *
 *   window.ZombiesSolvers.mountSimonSaysSolver("simon-says-solver-react", {
 *       title: "Simon Says Solver",
 *       colours: ["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"],
 *       names: ["Bar", "Atrium", "Kitchen", "Vault"],
 *   });
 *
 * `names` is optional and lines up with `colours` by position. Without it a pad
 * is named after its own colour, which is right when the reader is looking at
 * four coloured lights and wrong when they are looking at four things the map
 * already calls something. Leave an entry blank to keep the colour name for
 * that one pad.
 *
 * How long the sequence runs is NOT configured, because in most of these
 * puzzles the reader does not know it until it stops: it can be four flashes or
 * forty, and a round can add to it. So the recorder never fills up, never
 * disables a pad, and never asks for a length up front. Tapping is the only
 * thing that ends it, and Undo is there for the mistimed tap.
 *
 * The pads can also be dragged into the order they appear in game, which is
 * often randomised per game and cannot be baked into the mount call. That
 * arrangement is deliberately temporary: it lives in component state, is gone
 * on reload, and is purely where a pad sits. Which pad a tap recorded is held
 * as the pad's own index, so rearranging never rewrites a recorded sequence.
 *
 * `canArrange` turns that off. It defaults to true, because a randomised layout
 * is the usual case, and a page passing `canArrange: false` is saying the pads
 * sit where the map puts them every game - Moon's four computers, say - so the
 * Arrange button would only be an invitation to shuffle a layout that already
 * matches. With it off, the button and the move arrows are never rendered.
 */

/** Used when a page mounts this with no palette, or with an unreadable one. */
const DEFAULT_COLOURS = ["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface Rgb {
    r: number;
    g: number;
    b: number;
}

interface Pad {
    /** Always #rrggbb, lowercase, whatever form the page wrote it in. */
    hex: string;
    /** Text colour that stays readable on top of `hex`. */
    ink: string;
    /** Human name for labels and reports, e.g. "Red". */
    name: string;
}

/** `#f00`, `f00`, `#FF0000` and `ff0000` all normalise to `#ff0000`. */
function normaliseColour(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const match = HEX.exec(raw.trim());
    if (!match) return null;
    const body = match[1].toLowerCase();
    const full = body.length === 3 ? body.replace(/./g, (c) => c + c) : body;
    return `#${full}`;
}

function toRgb(hex: string): Rgb {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

/**
 * Nearest everyday name for a colour, via HSL bands.
 *
 * The fallback when the page supplies no name of its own: a hex code is no use
 * in an aria-label, in a filed report, or to a reader reading the order back
 * off the screen. The swatch itself is the source of truth if a band call looks
 * off by one.
 */
function colourName({ r, g, b }: Rgb): string {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

    if (lightness <= 0.08) return "Black";
    if (saturation < 0.12) return lightness >= 0.9 ? "White" : "Grey";

    let hue: number;
    if (max === rn) hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = (bn - rn) / delta + 2;
    else hue = (rn - gn) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;

    if (hue < 15 || hue >= 345) return "Red";
    if (hue < 45) return lightness < 0.35 ? "Brown" : "Orange";
    if (hue < 70) return "Yellow";
    if (hue < 160) return "Green";
    if (hue < 200) return "Cyan";
    if (hue < 250) return "Blue";
    if (hue < 290) return "Purple";
    return "Pink";
}

/** Black or white, whichever the pad's own colour will not swallow. */
function inkFor({ r, g, b }: Rgb): string {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? "#101010" : "#ffffff";
}

/** A page-supplied name, or null to fall back to the colour's own. */
function givenName(names: string[] | undefined, index: number): string | null {
    if (!Array.isArray(names)) return null;
    const name = names[index];
    if (typeof name !== "string") return null;
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function buildPads(colours: string[] | undefined, names: string[] | undefined): Pad[] {
    // Paired before filtering, so dropping an unreadable colour takes its name
    // with it and never shifts the rest of the list onto the wrong pads.
    const valid = (Array.isArray(colours) ? colours : [])
        .map((raw, index) => ({ hex: normaliseColour(raw), given: givenName(names, index) }))
        .filter((entry): entry is { hex: string; given: string | null } => entry.hex !== null);
    const list = valid.length > 0
        ? valid
        : DEFAULT_COLOURS.map((hex, index) => ({ hex, given: givenName(names, index) }));

    // Two pads that land in the same band ("Green", "Green") would give the
    // reader two identical labels for two visibly different squares, so they
    // get numbered. Pads with a band to themselves keep the bare name, and a
    // name the page supplied is left exactly as it was written.
    const totals: Record<string, number> = {};
    for (const { hex, given } of list) {
        if (given) continue;
        const name = colourName(toRgb(hex));
        totals[name] = (totals[name] ?? 0) + 1;
    }

    const seen: Record<string, number> = {};
    return list.map(({ hex, given }) => {
        const rgb = toRgb(hex);
        if (given) return { hex, ink: inkFor(rgb), name: given };
        const base = colourName(rgb);
        seen[base] = (seen[base] ?? 0) + 1;
        return {
            hex,
            ink: inkFor(rgb),
            name: totals[base] > 1 ? `${base} ${seen[base]}` : base,
        };
    });
}

interface SimonSaysSolverProps {
    title?: string;
    colours?: string[];
    names?: string[];
    canArrange?: boolean;
}

export default function SimonSaysSolver({ title, colours, names, canArrange = true }: SimonSaysSolverProps) {
    /** Indices into `pads`, in the order the reader tapped them. */
    const [sequence, setSequence] = useState<number[]>([]);
    /**
     * Pad indices in the order the pads are laid out, or null while the page's
     * own order is untouched. Null rather than a filled-in array so the initial
     * state stays a static literal, which is what keeps the server prerender and
     * the first client render identical.
     */
    const [customOrder, setCustomOrder] = useState<number[] | null>(null);
    /**
     * Rearranging the pads instead of recording taps. Only ever true when
     * `canArrange` is on, because the Arrange button is the only way in and it
     * is not rendered otherwise - so nothing below needs to check both.
     */
    const [arranging, setArranging] = useState(false);
    const calcKeyRef = useRef(0);

    const pads = useMemo(() => buildPads(colours, names), [colours, names]);
    const order = customOrder ?? pads.map((_, index) => index);

    // The taps are the input here: the "answer" is just them read back, so the
    // order is the only thing worth carrying into a report, along with the
    // palette the page configured, which is what the positions mean.
    useSolverReport("SimonSaysSolver", () => ({
        "Pad colours": pads.map((pad) => `${pad.name} (${pad.hex})`),
        "Recorded order": sequence.map((index) => pads[index]?.name ?? "?"),
    }));

    const handleTap = (index: number) => {
        setSequence([...sequence, index]);
        calcKeyRef.current++;
    };

    const handleUndo = () => {
        if (sequence.length === 0) return;
        setSequence(sequence.slice(0, -1));
        calcKeyRef.current++;
    };

    const handleReset = () => {
        if (sequence.length === 0) return;
        setSequence([]);
        calcKeyRef.current++;
    };

    /** Swap the pad at `position` with its neighbour. */
    const movePad = (position: number, delta: number) => {
        const target = position + delta;
        if (target < 0 || target >= order.length) return;
        const next = [...order];
        next[position] = order[target];
        next[target] = order[position];
        setCustomOrder(next);
    };

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Tap each colour as it flashes, in the order it flashes, for as long as the sequence
                runs. The order you tapped is listed underneath. Tap <strong>Undo</strong> if you
                mistime one, or <strong>Reset</strong> to start the sequence again.
                {canArrange && (
                    <>
                        {" "}Tap <strong>Arrange</strong> to shuffle the pads into the order they
                        sit in game.
                    </>
                )}
            </p>

            <div className={`simon-pads${arranging ? " is-arranging" : ""}`}>
                {order.map((padIndex, position) => {
                    const pad = pads[padIndex];
                    // A tally, not the positions it holds: with no known length a
                    // pad can end up in a dozen places, and "1, 4, 9, 15" across a
                    // square does not fit or read. The order itself is underneath.
                    const taps = sequence.reduce((total, tapped) => total + (tapped === padIndex ? 1 : 0), 0);
                    return (
                        <div className="simon-pad-slot" key={`${pad.hex}-${padIndex}`}>
                            <button
                                type="button"
                                className="simon-pad"
                                style={{ "--pad-color": pad.hex, "--pad-ink": pad.ink } as preact.JSX.CSSProperties}
                                // Inert while arranging, so a tap aimed at a move
                                // arrow cannot land a flash nobody saw.
                                disabled={arranging}
                                aria-label={
                                    taps > 0
                                        ? `${pad.name}, tapped ${taps} time${taps === 1 ? "" : "s"}`
                                        : pad.name
                                }
                                onClick={() => handleTap(padIndex)}
                            >
                                {taps > 0 && (
                                    <span className="simon-pad__badge" aria-hidden="true">{taps}</span>
                                )}
                            </button>
                            {arranging && (
                                <div className="simon-pad-move">
                                    <button
                                        type="button"
                                        className="simon-move"
                                        disabled={position === 0}
                                        aria-label={`Move ${pad.name} left`}
                                        onClick={() => movePad(position, -1)}
                                    >
                                        &lsaquo;
                                    </button>
                                    <button
                                        type="button"
                                        className="simon-move"
                                        disabled={position === order.length - 1}
                                        aria-label={`Move ${pad.name} right`}
                                        onClick={() => movePad(position, 1)}
                                    >
                                        &rsaquo;
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="solver-controls is-centered">
                {/* Undo and Reset are recording actions, so while arranging the
                    row is just the way back out. */}
                {arranging ? (
                    <button
                        type="button"
                        className="btn btn--solver is-active"
                        onClick={() => setArranging(false)}
                    >
                        Done
                    </button>
                ) : (
                    <>
                        <button
                            type="button"
                            className="btn btn--solver"
                            disabled={sequence.length === 0}
                            onClick={handleUndo}
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            className="btn btn--solver"
                            disabled={sequence.length === 0}
                            onClick={handleReset}
                        >
                            Reset
                        </button>
                        {canArrange && (
                            <button
                                type="button"
                                className="btn btn--solver"
                                onClick={() => setArranging(true)}
                            >
                                Arrange
                            </button>
                        )}
                    </>
                )}
            </div>

            <div className="solver-output is-recalc" key={calcKeyRef.current} aria-live="polite">
                {/* The chips and nothing else. Only what has actually been
                    tapped, too: there is no known length to lay out empty slots
                    for, and one trailing placeholder would read as "one flash
                    left" on a sequence that may have twenty. */}
                {sequence.length > 0 && (
                    <ol className="simon-sequence">
                        {sequence.map((padIndex, slot) => {
                            const pad = pads[padIndex];
                            return (
                                <li
                                    key={slot}
                                    className="simon-slot"
                                    style={pad ? ({ "--pad-color": pad.hex, "--pad-ink": pad.ink } as preact.JSX.CSSProperties) : undefined}
                                >
                                    <span className="simon-slot__chip">{slot + 1}</span>
                                    <span className="simon-slot__name">{pad ? pad.name : "?"}</span>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>
        </div>
    );
}
