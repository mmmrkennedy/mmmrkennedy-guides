import { useEffect, useMemo, useState } from "preact/hooks";

type Sym = "." | "-";
type KeyName = "ARCHER" | "CROSS";
type NumberWord = "FIFTEEN" | "EIGHTEEN" | "TWENTY" | "TWENTYFIVE" | "THIRTY";
type Phase = "key" | "listen" | "input";

const MORSE: Record<string, string> = {
    A: ".-",   B: "-...", C: "-.-.", D: "-..",  E: ".",    F: "..-.",
    G: "--.",  H: "....", I: "..",   J: ".---", K: "-.-",  L: ".-..",
    M: "--",   N: "-.",   O: "---",  P: ".--.", Q: "--.-", R: ".-.",
    S: "...",  T: "-",    U: "..-",  V: "...-", W: ".--",  X: "-..-",
    Y: "-.--", Z: "--..",
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

interface Group {
    letter: string;
    symbols: Sym[];
}

function toGroups(word: string): Group[] {
    return [...word].map((letter) => ({ letter, symbols: [...MORSE[letter]] as Sym[] }));
}

function toFlat(word: string): Sym[] {
    return [...word].flatMap((letter) => [...MORSE[letter]] as Sym[]);
}

/* The code terminal transmits "KILLOVER" + the number word, enciphered with a
   Vigenere cipher keyed on the word from the first terminal. Because the key
   and preamble are both fixed, every message the terminal can produce is known
   ahead of time, so the solver only has to work out which of the five it is. */
function vigenere(plain: string, key: KeyName): string {
    return [...plain]
        .map((ch, i) => ALPHABET[(ALPHABET.indexOf(ch) + ALPHABET.indexOf(key[i % key.length])) % 26])
        .join("");
}

const PREAMBLE = "KILLOVER";
const NUMBERS: NumberWord[] = ["FIFTEEN", "EIGHTEEN", "TWENTY", "TWENTYFIVE", "THIRTY"];
const KEYS: KeyName[] = ["ARCHER", "CROSS"];

const NUMBER_LABEL: Record<NumberWord, string> = {
    FIFTEEN: "Fifteen",
    EIGHTEEN: "Eighteen",
    TWENTY: "Twenty",
    TWENTYFIVE: "Twenty-Five",
    THIRTY: "Thirty",
};

interface KeyPlan {
    openingGroups: Group[];
    openingFlat: Sym[];
    /* Kept in letter groups so a tail can be drawn as a strip, and flattened so
       a run of taps can be prefix-matched against it. */
    tailGroups: Record<NumberWord, Group[]>;
    tails: Record<NumberWord, Sym[]>;
}

function buildPlan(key: KeyName): KeyPlan {
    const opening = vigenere(PREAMBLE, key);
    const tailGroups = {} as Record<NumberWord, Group[]>;
    const tails = {} as Record<NumberWord, Sym[]>;
    for (const n of NUMBERS) {
        const cipher = vigenere(PREAMBLE + n, key).slice(PREAMBLE.length);
        tailGroups[n] = toGroups(cipher);
        tails[n] = tailGroups[n].flatMap((g) => g.symbols);
    }
    return { openingGroups: toGroups(opening), openingFlat: toFlat(opening), tailGroups, tails };
}

const PLANS: Record<KeyName, KeyPlan> = { ARCHER: buildPlan("ARCHER"), CROSS: buildPlan("CROSS") };

/* What to key into the panel above Bombstoppers, one continuous word per
   number. Fifteen is the odd one out: it carries an "AR" prosign the other
   four don't. */
const PANEL_WORDS: Record<NumberWord, string> = {
    FIFTEEN: "FIFTEENAR",
    EIGHTEEN: "EIGHTEEN",
    TWENTY: "TWENTY",
    TWENTYFIVE: "TWENTYFIVE",
    THIRTY: "THIRTY",
};

/* Only for the twenty/twenty-five split, where the number was never actually
   read: enter twenty, listen for the completion sound, add five if it didn't
   play. Same beeps as TWENTYFIVE, just broken at the point you have to stop
   and listen. A known twenty-five is entered straight through instead. */
const SPLIT_WORDS = ["TWENTY", "FIVE"];

/* Stable empty reference, so hooks reading the plan before a key is picked
   don't see a new array identity on every render. */
const NO_SYMS: Sym[] = [];

const GLYPH: Record<Sym, string> = { ".": "●", "-": "▬" };
const SIDE: Record<Sym, string> = { ".": "Left", "-": "Right" };
const LENGTH_WORD: Record<Sym, string> = { ".": "short beep", "-": "long beep" };

function isPrefix(candidate: Sym[], taps: Sym[]): boolean {
    return taps.length <= candidate.length && taps.every((s, i) => s === candidate[i]);
}

interface StripProps {
    groups: Group[];
    /* How many symbols have been tapped, counting from the start of the strip. */
    progress: number;
    /* Index of the first bad tap, or -1. */
    badIndex: number;
    showLetters: boolean;
}

function SymbolStrip({ groups, progress, badIndex, showLetters }: StripProps) {
    let index = -1;
    return (
        <div className="morse-strip">
            {groups.map((group, gi) => (
                <div className="morse-group" key={`g-${gi}`}>
                    <div className="morse-group__syms">
                        {group.symbols.map((sym, si) => {
                            index++;
                            let state = "is-pending";
                            if (badIndex >= 0 && index === badIndex) state = "is-bad";
                            else if (index < progress) state = "is-done";
                            else if (index === progress) state = "is-current";
                            return (
                                <span className={`morse-sym ${state}`} key={`s-${gi}-${si}`}>
                                    {GLYPH[sym]}
                                </span>
                            );
                        })}
                    </div>
                    {showLetters && <span className="morse-group__letter">{group.letter}</span>}
                </div>
            ))}
        </div>
    );
}

interface TapPadsProps {
    onTap: (sym: Sym) => void;
    disabled?: boolean;
}

function TapPads({ onTap, disabled }: TapPadsProps) {
    return (
        <div className="solver-controls">
            {([".", "-"] as Sym[]).map((sym) => (
                <button
                    type="button"
                    key={sym}
                    className="morse-pad"
                    disabled={disabled}
                    aria-label={LENGTH_WORD[sym]}
                    onClick={() => onTap(sym)}
                >
                    <span className="morse-pad__glyph">{GLYPH[sym]}</span>
                    <span className="morse-pad__label">{sym === "." ? "Short" : "Long"}</span>
                    <span className="morse-pad__hint">
                        <kbd>{sym === "." ? "←" : "→"}</kbd>
                    </span>
                </button>
            ))}
        </div>
    );
}

interface Props {
    title?: string;
    /* Optional id of an existing <select> on the page holding the ARCHER/CROSS
       choice. When present the solver adopts it and skips its own key step. */
    keySelectId?: string;
}

export default function IWBeastVenomYMorseSolver({ title, keySelectId }: Props) {
    const [phase, setPhase] = useState<Phase>("key");
    /* Step 1 is a single beep, so this is one symbol rather than a run. */
    const [keyTap, setKeyTap] = useState<Sym | null>(null);
    const [activeKey, setActiveKey] = useState<KeyName | null>(null);
    /* True when the key came from the page's dropdown rather than from step 1,
       so step 2 can say where it got the key from. */
    const [keyFromSelect, setKeyFromSelect] = useState(false);
    const [taps, setTaps] = useState<Sym[]>([]);
    const [chosenNumber, setChosenNumber] = useState<NumberWord | null>(null);
    const [numberUncertain, setNumberUncertain] = useState(false);
    const [peekNumber, setPeekNumber] = useState<NumberWord | null>(null);
    const [stage, setStage] = useState(0);
    const [inputIndex, setInputIndex] = useState(0);

    /* Adopt the guide's own key dropdown when the solver is embedded next to it,
       so the reader doesn't pick the same key twice. */
    useEffect(() => {
        if (!keySelectId) return;
        const select = document.getElementById(keySelectId) as HTMLSelectElement | null;
        if (!select) return;

        const adopt = () => {
            const value = select.value.toUpperCase();
            if (value !== "ARCHER" && value !== "CROSS") return;
            setActiveKey(value as KeyName);
            setKeyFromSelect(true);
            setKeyTap(null);
            setTaps([]);
            setChosenNumber(null);
            setStage(0);
            setInputIndex(0);
            setPhase("listen");
        };

        adopt();
        select.addEventListener("change", adopt);
        return () => select.removeEventListener("change", adopt);
    }, [keySelectId]);

    /* ---- key phase ---- */
    /* One beep settles it: ARCHER's cipher opens short, CROSS's opens long. */
    const tappedKey: KeyName | null =
        keyTap === null ? null : keyTap === "." ? "ARCHER" : "CROSS";

    /* ---- listen phase ---- */
    const plan = activeKey ? PLANS[activeKey] : null;
    const openingFlat = plan ? plan.openingFlat : NO_SYMS;
    const openingTaps = taps.slice(0, openingFlat.length);
    const openingBad = openingTaps.findIndex((s, i) => s !== openingFlat[i]);
    const numberTaps = taps.slice(openingFlat.length);
    const inOpening = taps.length < openingFlat.length;

    const aliveNumbers = useMemo(() => {
        if (!plan || openingBad >= 0) return [];
        return NUMBERS.filter((n) => isPrefix(plan.tails[n], numberTaps));
    }, [plan, openingBad, numberTaps]);

    /* Twenty's transmission is a strict prefix of twenty-five's, so a prefix
       alone can never separate them. It can still be settled if the message
       loops: past twenty's tail, twenty-five carries on while a repeat starts
       the opening over. */
    const loopedTwenty = useMemo(() => {
        if (!plan || aliveNumbers.length > 0 || openingBad >= 0) return false;
        const twenty = plan.tails.TWENTY;
        if (!isPrefix(twenty, numberTaps.slice(0, twenty.length))) return false;
        const rest = numberTaps.slice(twenty.length);
        return rest.length > 0 && isPrefix(openingFlat, rest);
    }, [plan, aliveNumbers, openingBad, numberTaps, openingFlat]);

    const resolved: NumberWord | null = loopedTwenty
        ? "TWENTY"
        : aliveNumbers.length === 1
          ? aliveNumbers[0]
          : null;
    const isSplit =
        aliveNumbers.length === 2 &&
        aliveNumbers.includes("TWENTY") &&
        aliveNumbers.includes("TWENTYFIVE");
    const noMatch = !inOpening && openingBad < 0 && aliveNumbers.length === 0 && !loopedTwenty;

    /* ---- input phase ---- */
    const words = !chosenNumber
        ? []
        : numberUncertain
          ? SPLIT_WORDS
          : [PANEL_WORDS[chosenNumber]];
    const stageWord = words[stage] ?? "";
    const stageGroups = stageWord ? toGroups(stageWord) : [];
    const stageFlat = stageWord ? toFlat(stageWord) : [];
    const stageDone = stageWord !== "" && inputIndex >= stageFlat.length;
    const hasSecondStage = words.length > 1;

    /* ---- actions ---- */
    /* `uncertain` marks the twenty/twenty-five split, where TWENTYFIVE is a
       best guess rather than a reading. Step 3 needs the distinction: a known
       twenty-five is keyed straight through as one word, an unknown one has to
       stop after twenty and check for the completion sound. */
    const goToInput = (n: NumberWord, uncertain = false) => {
        setChosenNumber(n);
        setNumberUncertain(uncertain);
        setStage(0);
        setInputIndex(0);
        setPhase("input");
    };

    const chooseKey = (k: KeyName) => {
        setActiveKey(k);
        setKeyFromSelect(false);
        setTaps([]);
        setPhase("listen");
    };

    /* Step 3 only counts taps: the strip already says which button to press in
       game, so which pad the reader hits to advance doesn't matter. */
    const advance = () => {
        if (!stageDone) setInputIndex((prev) => prev + 1);
    };

    const tap = (sym: Sym) => {
        /* Step 1 takes exactly one beep. Guarded here as well as on the pads so
           the keyboard can't get past one either. */
        if (phase === "key") setKeyTap((prev) => prev ?? sym);
        else if (phase === "listen") setTaps((prev) => [...prev, sym]);
        else if (phase === "input") advance();
    };

    const undo = () => {
        if (phase === "key") setKeyTap(null);
        else if (phase === "listen") setTaps((prev) => prev.slice(0, -1));
        else if (phase === "input") setInputIndex((prev) => Math.max(0, prev - 1));
    };

    const resetAll = () => {
        setPhase(activeKey && keySelectId ? "listen" : "key");
        setKeyTap(null);
        if (!keySelectId) setActiveKey(null);
        setTaps([]);
        setChosenNumber(null);
        setNumberUncertain(false);
        setStage(0);
        setInputIndex(0);
    };

    const handleKey = (key: string, event: { preventDefault: () => void }) => {
        if (key === "ArrowLeft" || key === ".") {
            event.preventDefault();
            tap(".");
        } else if (key === "ArrowRight" || key === "-") {
            event.preventDefault();
            tap("-");
        } else if (key === "Backspace") {
            event.preventDefault();
            undo();
        } else if (phase === "input" && (key === " " || key === "Enter")) {
            event.preventDefault();
            advance();
        }
    };

    /* ---- render helpers ---- */
    const renderKeyPhase = () => (
        <>
            <p className="morse-step">Step 1 of 3 - Your key</p>
            <p className="solver-instructions">
                Enter the first element from the morse sequence from the terminal right of Bang Bangs. This will show you your key.
            </p>

            <div className={`solver-output morse-taps${keyTap === null ? " is-empty" : ""}`}>
                {keyTap === null ? "Waiting for the first beep…" : GLYPH[keyTap]}
            </div>

            {/* No error case to handle: either beep names a key, so the only way
                to be wrong here is to hear the wrong one and undo. */}
            {tappedKey && (
                <div className="morse-banner morse-banner--answer">Your key is {tappedKey}</div>
            )}

            <TapPads onTap={tap} disabled={keyTap !== null} />

            <div className="solver-controls">
                <button className="btn btn--solver" onClick={undo} disabled={keyTap === null}>
                    Undo
                </button>
                {tappedKey && (
                    <button className="btn btn--solver is-active" onClick={() => chooseKey(tappedKey)}>
                        Next
                    </button>
                )}
            </div>

            <div className="morse-skip">
                <span>Know your key already? Select it: </span>
                {KEYS.map((k) => (
                    <button type="button" className="morse-link" key={k} onClick={() => chooseKey(k)}>
                        {k}
                    </button>
                ))}
            </div>
        </>
    );

    const renderListenPhase = () => (
        <>
            <p className="morse-step">Step 2 of 3 - Code terminal below Bang Bangs - Key: {activeKey}</p>
            {keyFromSelect && (
                <p className="solver-instructions">
                    Step 1 (finding the Key) was autocompleted. {activeKey} came from the key dropdown above.
                </p>
            )}
            <p className="solver-instructions">Keep tapping along with every beep as you hear until the solver shows you your number.</p>
            {plan && (
                <SymbolStrip
                    groups={plan.openingGroups}
                    progress={taps.length}
                    badIndex={openingBad}
                    showLetters={false}
                />
            )}

            {openingBad >= 0 && (
                <p className="solver-error">
                    Beep {openingBad + 1} doesn&rsquo;t match. Undo, or reset and catch the next pass.
                </p>
            )}

            {!inOpening && openingBad < 0 && (
                <div className={`solver-output morse-taps${numberTaps.length === 0 ? " is-empty" : ""}`}>
                    {numberTaps.length === 0
                        ? "Waiting for the next beep…"
                        : numberTaps.map((s) => GLYPH[s]).join(" ")}
                </div>
            )}

            {!inOpening && openingBad < 0 && !resolved && !isSplit && aliveNumbers.length > 0 && plan && (
                <div className="morse-candidates">
                    <div className="morse-candidate-row">
                        <strong>Still possible:</strong>
                        {aliveNumbers.map((n) => (
                            <button
                                type="button"
                                className={`morse-chip${peekNumber === n ? " is-peeking" : ""}`}
                                key={n}
                                /* Hover on a mouse, tap on a touchscreen. Without
                                   the pointerType guard a tap would run the hover
                                   path too and the click would toggle the preview
                                   straight back off. */
                                onPointerEnter={(e) => {
                                    if (e.pointerType === "mouse") setPeekNumber(n);
                                }}
                                onPointerLeave={(e) => {
                                    if (e.pointerType === "mouse")
                                        setPeekNumber((prev) => (prev === n ? null : prev));
                                }}
                                onClick={() => setPeekNumber((prev) => (prev === n ? null : n))}
                            >
                                {NUMBER_LABEL[n]}
                            </button>
                        ))}
                    </div>

                    {/* Preview sits in the flow rather than floating: these
                        sequences run to 31 beeps, which no tooltip can hold
                        over a panel this narrow without escaping it. Progress
                        lights the beeps already matched, so the unlit tail is
                        what you'd hear next if it is this number. */}
                    <div className="solver-output morse-peek">
                        {peekNumber && aliveNumbers.includes(peekNumber) ? (
                            <>
                                <span className="morse-peek__label">
                                    {NUMBER_LABEL[peekNumber]} sounds like
                                </span>
                                <SymbolStrip
                                    groups={plan.tailGroups[peekNumber]}
                                    progress={numberTaps.length}
                                    badIndex={-1}
                                    showLetters={false}
                                />
                            </>
                        ) : (
                            <span className="morse-peek__hint">
                                Hover or tap a number to preview its beeps
                            </span>
                        )}
                    </div>
                </div>
            )}

            {noMatch && <p className="solver-error">No match. You missed a beep. Undo, or reset.</p>}

            {isSplit && (
                <>
                    <div className="morse-banner morse-banner--split">Twenty or Twenty-Five</div>
                    <p className="solver-instructions">
                        "Twenty" and "Twenty-Five" are identical from now on. Continue tapping the code to find out which is correct for sure, or go to the next step; it will also help you find your number.
                    </p>
                    <div className="solver-controls">
                        <button
                            className="btn btn--solver is-active"
                            onClick={() => goToInput("TWENTYFIVE", true)}
                        >
                            Next
                        </button>
                    </div>
                </>
            )}

            {resolved && (
                <>
                    <div className="morse-banner morse-banner--answer">
                        Your number: {NUMBER_LABEL[resolved]}
                    </div>
                    <div className="solver-controls">
                        <button className="btn btn--solver is-active" onClick={() => goToInput(resolved)}>Next</button>
                    </div>
                    {loopedTwenty && (
                        <p className="solver-instructions">The message looped, so it&rsquo;s twenty.</p>
                    )}
                </>
            )}

            <TapPads onTap={tap} />

            <div className="solver-controls">
                <button className="btn btn--solver" onClick={undo} disabled={taps.length === 0}>
                    Undo
                </button>
                <button className="btn btn--solver" onClick={() => setTaps([])} disabled={taps.length === 0}>
                    Reset
                </button>
                <button className="btn btn--solver" onClick={resetAll}>
                    Change key
                </button>
            </div>

            <div className="morse-skip">
                <span>Know your number already? Select it:</span>
                {NUMBERS.map((n) => (
                    <button type="button" className="morse-link" key={n} onClick={() => goToInput(n)}>
                        {NUMBER_LABEL[n]}
                    </button>
                ))}
            </div>
        </>
    );

    const renderInputPhase = () => {
        if (!chosenNumber) return null;
        const currentSym = stageFlat[inputIndex];

        return (
            <>
                <p className="morse-step">
                    Step 3 of 3 - Panel above Bombstoppers -{" "}
                    {numberUncertain ? "Twenty or Twenty-Five" : NUMBER_LABEL[chosenNumber]}
                </p>
                <p className="solver-instructions">
                    Tap the button each time you press a button in-game to help you keep track of your input.
                </p>

                {hasSecondStage && (
                    <p className="morse-section-label">
                        Entry {stage + 1} of 2: {stage === 0 ? "twenty" : "five"}
                    </p>
                )}

                {!stageDone ? (
                    <button type="button" className="morse-current" onClick={() => tap(currentSym)}>
                        <span className="morse-current__glyph">{GLYPH[currentSym]}</span>
                        <span className="morse-current__label">{SIDE[currentSym]}</span>
                        <span className="morse-current__sub">{LENGTH_WORD[currentSym]}</span>
                    </button>
                ) : (
                    <div className="morse-banner morse-banner--answer">
                        {stageWord === "TWENTY" && hasSecondStage
                            ? "Twenty Entered"
                            : "Done"}
                    </div>
                )}

                <SymbolStrip groups={stageGroups} progress={inputIndex} badIndex={-1} showLetters={true} />

                {/* Only reachable from the split, since that's the one case
                    with a second word. Entering five is what settles it. */}
                {stageDone && stage === 0 && hasSecondStage && (
                    <div className="solver-controls">
                        <button
                            className="btn btn--solver is-active"
                            onClick={() => {
                                setStage(1);
                                setInputIndex(0);
                            }}
                        >
                            No Completion Sound?
                        </button>
                    </div>
                )}

                <div className="solver-controls">
                    <button className="btn btn--solver" onClick={undo} disabled={inputIndex === 0}>
                        Undo
                    </button>
                    <button className="btn btn--solver" onClick={() => setInputIndex(0)} disabled={inputIndex === 0}>
                        Restart entry
                    </button>
                    <button className="btn btn--solver" onClick={() => setPhase("listen")}>
                        Back
                    </button>
                </div>
            </>
        );
    };

    return (
        <div
            className="solver-container solver-container--morse"
            data-phase={phase}
            tabIndex={0}
            onKeyDown={(e) => handleKey(e.key, e)}
        >
            {title && <h2 className="solver-title">{title}</h2>}
            {phase === "key" && renderKeyPhase()}
            {phase === "listen" && renderListenPhase()}
            {phase === "input" && renderInputPhase()}

        </div>
    );
}
