import { useEffect, useMemo, useState } from "preact/hooks";

/*
 * The seven word groups from build_word_codex_list() in
 * scripts/cp/maps/cp_disco/disco_mpq.gsc, in the game's own order.
 *
 * The puzzle draws from ONE group at a time: determine_puzzle_wordlist() picks a
 * group (never the same one twice running) and walks its ten words in shuffled
 * order, only moving to another group once all ten have been failed. So the
 * group a word belongs to says what the rest of the game can throw at you.
 *
 * Nothing uses the grouping yet - the lists are flattened straight back into a
 * single alphabetical list below, and the filter behaves exactly as it did.
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

/* In no group. solve_word_logic() rolls randomint(101) == 100 each time it
   picks a word and swaps in this one instead - once per game at most. Rare, but
   without it the filter dead-ends on a word the game is really showing you. */
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

/* Word -> its group. SAVAGEMADETHIS is absent on purpose: the game substitutes
   it for whatever word was drawn without touching the walk through the group,
   so it is evidence of nothing and must never pin a group on its own. */
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
 * What the current matches say about the active group.
 *
 * pin   every grouped match shares a group, so it is settled whichever of those
 *       words it turns out to be. An ungrouped match alongside them does not
 *       block it: SA still reads Extinction off SAMANTHA.
 * clear there are matches and none of them belong to a group. SAVAGEMADETHIS is
 *       the only word that can do this, and once SAV rules everything else out,
 *       any label would be naming a group with nothing tinted under it - the SA
 *       reading it came from has just been disproved.
 * hold  matches disagree, or nothing is typed, or nothing matches at all. The
 *       last answer stands; a typo should not wipe it.
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

/** Group members first, everything else after; alphabetical within each. */
function sortGroupFirst(matchingWords: string[], group: string | null): string[] {
    if (group === null) return matchingWords;
    const inGroup = matchingWords.filter((word) => GROUP_OF.get(word) === group);
    if (inGroup.length === 0 || inGroup.length === matchingWords.length) return matchingWords;
    return [...inGroup, ...matchingWords.filter((word) => GROUP_OF.get(word) !== group)];
}

export default function IWMainQuestWordFilter({ title }: { title?: string }) {
    const [inputString, setInputString] = useState<string>("");
    const [group, setGroup] = useState<string | null>(null);

    const { matchingWords, nextLetters } = useMemo(
        () => filterWordsByPrefix(inputString),
        [inputString],
    );

    const signal = useMemo(() => readGroup(matchingWords), [matchingWords]);

    /* Latched, because the group has to outlive the word that revealed it: miss
       a letter and the puzzle moves to the next word in the SAME group, so the
       hint earns its keep on the word AFTER the one that identified it - by
       which point the box has been retyped from scratch. A later pin replaces
       it, which is also what recovers from the group rolling over after ten
       misses, and a clear drops it when the letters land on the easter egg. */
    useEffect(() => {
        if (signal.kind === "pin") setGroup(signal.group);
        else if (signal.kind === "clear") setGroup(null);
    }, [signal]);

    /* Ordering and highlighting only. Which words match is still a plain
       prefix test - the group never removes anything from the list. */
    const displayWords = sortGroupFirst(matchingWords, group);

    return (
        <div className="solver-container solver-container--word-filter">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Type your in-game letters to filter the word list. The solver shows matching words and the possible next letters based on your current input automatically. The words are in groups of ten. Once the solver determines your group, it'll highlight those words. The game pickes a group when the step starts, then if you fail, it only selects a new word from that group.
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