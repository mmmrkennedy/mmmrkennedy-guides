import { useMemo, useState } from "preact/hooks";

const words: string[] = [
    "ACTORS",
    "AFTERLIFE",
    "ANCESTOR",
    "ARCADE",
    "ARTHUR",
    "AUDITION",
    "BASEMENT",
    "BEVERLYHILLS",
    "BLACKCAT",
    "BOAT",
    "BREEDER",
    "BROADWAY",
    "BRUTE",
    "BUMPERCARS",
    "CHARMS",
    "COMICBOOKS",
    "CRANE",
    "CRYPTID",
    "DANCE",
    "DAVIDARCHER",
    "DEATH",
    "DIRECTOR",
    "DISCO",
    "DRAGON",
    "DRCROSS",
    "FAIRIES",
    "FORGEFREEZE",
    "GEYSER",
    "GHETTO",
    "HARPOON",
    "HIVES",
    "INFERNO",
    "KATANA",
    "KEVINSMITH",
    "KRAKEN",
    "KUNGFU",
    "LOSANGELES",
    "MCINTOSH",
    "MEMORIES",
    "MEPHISTOPHELES",
    "NEWYORK",
    "NIGHTFALL",
    "NUNCHUCKS",
    "OBELISK",
    "OCTONIAN",
    "PAMGRIER",
    "PINKCAT",
    "PUNKS",
    "RATKING",
    "REALITYTV",
    "REDWOODS",
    "ROLLERCOASTER",
    "ROLLERSKATES",
    "SAMANTHA",
    "SHAOLIN",
    "SHIELD",
    "SHUFFLE",
    "SLASHER",
    "SIXTYMILLION",
    "SLIDE",
    "SNAKE",
    "SPACELAND",
    "STAFF",
    "SUBWAY",
    "TIGER",
    "TREES",
    "WEREWOLFPOETS",
    "WINONAWYLER",
    "YETIEYES",
    "ZAPPER",
];

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

export default function IWMainQuestWordFilter({ title }: { title?: string }) {
    const [inputString, setInputString] = useState<string>("");

    const { matchingWords, nextLetters } = useMemo(
        () => filterWordsByPrefix(inputString),
        [inputString],
    );

    return (
        <div className="solver-container solver-container--word-filter">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Type your in-game letters to filter the word list. The solver shows matching words and the possible next letters based on your current input automatically.
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
                                <img
                                    className="solver-letter-cell__image"
                                    src={`${SYMBOL_PATH}${letter.toLowerCase()}.webp`}
                                    alt=""
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="solver-output">
                <p>
                    <strong>Matching words ({matchingWords.length}):</strong>
                </p>
                {matchingWords.length > 0 ? (
                    <ul className="solver-word-list">
                        {matchingWords.map((word) => (
                            <li key={word}>{word}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="solver-word-list--empty">No matches.</p>
                )}
            </div>
        </div>
    );
}