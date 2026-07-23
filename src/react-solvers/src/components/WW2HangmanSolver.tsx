import { useMemo, useState } from "preact/hooks";

const possibleWords: string[] = [
    "DAMNATION", // Nuke
    "REAPER", // Insta-Kill
    "GEISTKRAFT", // Full Charge
    "FAMISHED", // Max Ammo
    "GLUTTONY", // Double Jolts
    "WONDER", // Tesla Gun & Ripsaw
    "THEJACKBOX", // Jack-in-the-Boxes
];

function suggestWords(revealedSequence: string, guessedLetters: string): string[] {
    const revealed = revealedSequence.toUpperCase();
    const guessed = guessedLetters.toUpperCase();

    return possibleWords.filter((word) => {
        let wordIndex = 0;
        for (const letter of revealed) {
            let found = false;
            while (wordIndex < word.length) {
                if (word[wordIndex] === letter) {
                    found = true;
                    wordIndex++;
                    break;
                }
                wordIndex++;
            }
            if (!found) return false;
        }

        for (const letter of guessed) {
            if (!word.includes(letter)) continue;
            if (!revealed.includes(letter)) return false;
        }

        return true;
    });
}

export default function WW2HangmanSolver({ title }: { title?: string }) {
    const [revealedLetters, setRevealedLetters] = useState<string>("");
    const [guessedLetters, setGuessedLetters] = useState<string>("");

    const result = useMemo(
        () => suggestWords(revealedLetters, guessedLetters),
        [revealedLetters, guessedLetters],
    );

    return (
        <div className="solver-container solver-container--hangman">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Enter the correct letters in order, along with any wrong guesses. The Solver will automatically filter the words.
            </p>

            <div className="solver-form-row">
                <label htmlFor="revealed-letters">Correct letters:</label>
                <input
                    type="text"
                    id="revealed-letters"
                    value={revealedLetters}
                    onInput={(e) => setRevealedLetters((e.target as HTMLInputElement).value)}
                    placeholder="In order…"
                    autocomplete="off"
                    spellcheck={false}
                    autocapitalize="characters"
                />
            </div>

            <div className="solver-form-row">
                <label htmlFor="guessed-letters">Incorrect letters:</label>
                <input
                    type="text"
                    id="guessed-letters"
                    value={guessedLetters}
                    onInput={(e) => setGuessedLetters((e.target as HTMLInputElement).value)}
                    placeholder="Wrong guesses"
                    autocomplete="off"
                    spellcheck={false}
                    autocapitalize="characters"
                />
            </div>

            <div className="solver-output" aria-live="polite">
                <p>
                    <strong>Possible words ({result.length}):</strong>
                </p>
                {result.length > 0 ? (
                    <ul className="solver-word-list">
                        {result.map((word) => (
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