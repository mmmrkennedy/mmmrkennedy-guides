import { useEffect, useMemo, useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

/*
 * Groups from build_word_codex_list() in scripts/cp/maps/cp_disco/disco_mpq.gsc,
 * in game order. determine_puzzle_wordlist() walks one group's ten words
 * (shuffled) until all ten fail, then picks a different group.
 */
const RAVE: string[] = [
    "HARPOON", "TREES", "DANCE", "BASEMENT", "SLASHER",
    "MEMORIES", "CHARMS", "BOAT", "KEVINSMITH", "FAIRIES",
];

const SPACELAND: string[] = [
    "BRUTE", "OCTONIAN", "ROLLERCOASTER", "ARCADE", "SLIDE",
    "GEYSER", "ZAPPER", "FORGEFREEZE", "BUMPERCARS", "YETIEYES",
];

const DISCO: string[] = [
    "ROLLERSKATES", "KATANA", "KUNGFU", "NUNCHUCKS", "DRAGON",
    "CRANE", "SNAKE", "TIGER", "PAMGRIER", "ARTHUR",
];

const DISCO2: string[] = [
    "DISCO", "RATKING", "SUBWAY", "PUNKS", "BLACKCAT",
    "PINKCAT", "INFERNO", "MCINTOSH", "STAFF", "SHIELD",
];

const EXTINCTION: string[] = [
    "CRYPTID", "DRCROSS", "HIVES", "ANCESTOR", "BREEDER",
    "KRAKEN", "OBELISK", "DAVIDARCHER", "NIGHTFALL", "SAMANTHA",
];

const WILLARD: string[] = [
    "SHUFFLE", "WINONAWYLER", "DIRECTOR", "DEATH", "REDWOODS",
    "MEPHISTOPHELES", "SIXTYMILLION", "AFTERLIFE", "SPACELAND", "SHAOLIN",
];

const CHARACTERS: string[] = [
    "WEREWOLFPOETS", "LOSANGELES", "REALITYTV", "BEVERLYHILLS", "GHETTO",
    "BROADWAY", "COMICBOOKS", "NEWYORK", "ACTORS", "AUDITION",
];

/* In no group. solve_word_logic() swaps it in on randomint(101) == 100, at most
   once per game. */
const EASTER_EGG: string[] = ["SAVAGEMADETHIS"];

const GROUPS: { label: string; words: string[] }[] = [
    { label: "Rave", words: RAVE },
    { label: "Spaceland", words: SPACELAND },
    { label: "Disco", words: DISCO },
    { label: "Disco 2", words: DISCO2 },
    { label: "Extinction", words: EXTINCTION },
    { label: "Willard", words: WILLARD },
    { label: "Characters", words: CHARACTERS },
];

/* SAVAGEMADETHIS is left out on purpose: the game substitutes it without leaving
   the current group, so it must never pin a group. */
const GROUP_OF = new Map<string, string>(
    GROUPS.flatMap((group) => group.words.map((word): [string, string] => [word, group.label])),
);

const words: string[] = [
    ...RAVE,
    ...SPACELAND,
    ...DISCO,
    ...DISCO2,
    ...EXTINCTION,
    ...WILLARD,
    ...CHARACTERS,
    ...EASTER_EGG,
].sort();

const SYMBOL_PATH = "/games/IW/wyler_language_symbols/";

interface FilterResult {
    matchingWords: string[];
    nextLetters: string[];
}

function filterWordsByPrefix(prefix: string): FilterResult {
    if (prefix === "") {
        return { matchingWords: words, nextLetters: [] };
    }

    const lowerPrefix = prefix.toLowerCase();
    const matchingWords = words.filter((word) => word.toLowerCase().startsWith(lowerPrefix));

    const nextLetters = Array.from(
        new Set(
            matchingWords
                .map((word) => word.slice(prefix.length))
                .filter((remaining) => remaining.length > 0)
                .map((remaining) => remaining.charAt(0)),
        ),
    ).sort();

    return { matchingWords, nextLetters };
}

type GroupSignal =
    | { kind: "pin"; group: string }
    | { kind: "clear" }
    | { kind: "hold" };

/**
 * pin: ungrouped matches don't block it (SA still reads Extinction off SAMANTHA).
 * clear: only SAVAGEMADETHIS matches, which disproves the earlier SA pin.
 * hold: keep the last group, so a typo doesn't wipe it.
 */
function readGroup(matchingWords: string[]): GroupSignal {
    const found = new Set<string>();
    for (const word of matchingWords) {
        const group = GROUP_OF.get(word);
        if (group) found.add(group);
    }
    if (found.size === 1) return { kind: "pin", group: [...found][0] };
    if (found.size === 0 && matchingWords.length > 0) return { kind: "clear" };
    return { kind: "hold" };
}

function sortGroupFirst(matchingWords: string[], group: string | null): string[] {
    if (group === null) return matchingWords;
    const inGroup = matchingWords.filter((word) => GROUP_OF.get(word) === group);
    if (inGroup.length === 0 || inGroup.length === matchingWords.length) return matchingWords;
    return [...inGroup, ...matchingWords.filter((word) => GROUP_OF.get(word) !== group)];
}

export default function ShaolinWordFilter({ title }: { title?: string }) {
    const [inputString, setInputString] = useState<string>("");
    const [group, setGroup] = useState<string | null>(null);

    useSolverReport("ShaolinWordFilter", () => ({
        "Letters typed": inputString,
        "Word group selected": group,
    }));

    const { matchingWords, nextLetters } = useMemo(
        () => filterWordsByPrefix(inputString),
        [inputString],
    );

    const signal = useMemo(() => readGroup(matchingWords), [matchingWords]);

    /* Latched: after a miss the game moves to another word in the same group, so
       the group must outlive the retyped box. A later pin covers the group
       rolling over after ten misses. */
    useEffect(() => {
        if (signal.kind === "pin") setGroup(signal.group);
        else if (signal.kind === "clear") setGroup(null);
    }, [signal]);

    const displayWords = sortGroupFirst(matchingWords, group);

    return (
        <div className="solver-container solver-container--word-filter">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Type letters to filter the list and automatically see matches and possible next letters. Words are grouped by ten. The solver highlights your group once identified. If you fail a step, the game just picks a new word from that same highlighted group. If you fail 10 words, a new group is chosen. <i>SAVAGEMADETHIS</i> is a secret bonus word, not in any group.
            </p>

            <div className="solver-form-row">
                <label htmlFor="prefix-input">Letters:</label>
                <input
                    id="prefix-input"
                    type="text"
                    value={inputString}
                    onInput={(e) => setInputString((e.currentTarget as HTMLInputElement).value)}
                    placeholder="Type letters…"
                    autocomplete="off"
                    spellcheck={false}
                />
            </div>

            {nextLetters.length > 0 && (
                <div className="solver-output">
                    <p>
                        <strong>Next possible letters ({nextLetters.length}):</strong>
                    </p>
                    <div className="solver-letter-grid">
                        {nextLetters.map((letter) => (
                            <div
                                key={letter}
                                className="solver-letter-cell is-static"
                                aria-label={letter}
                            >
                                <span className="solver-letter-cell__letter">{letter}</span>
                                <img loading="lazy"
                                    className="solver-letter-cell__image"
                                    src={`${SYMBOL_PATH}${letter.toLowerCase()}.webp`}
                                    alt=""
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {group !== null && (
                <p className="solver-group-label">
                    <span>
                        Group: <strong>{group}</strong>
                    </span>
                    <button
                        type="button"
                        className="solver-group-label__clear"
                        onClick={() => setGroup(null)}
                    >
                        clear group
                    </button>
                </p>
            )}

            <div className="solver-output">
                <p>
                    <strong>Matching words ({matchingWords.length}):</strong>
                </p>
                {displayWords.length > 0 ? (
                    <ul className="solver-word-list">
                        {displayWords.map((word) => (
                            <li
                                key={word}
                                className={GROUP_OF.get(word) === group ? "is-group-match" : undefined}
                            >
                                {word}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="solver-word-list--empty">No matches.</p>
                )}
            </div>
        </div>
    );
}