import { useMemo, useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

/*
 * Tables generated from the game files (checked against cp_town_chemistry.gsc):
 *   cp/zombies/elements.csv    - heat/pressure per value set (cols 8-19)
 *   cp/zombies/compounds.csv   - what each compound is made from
 *   cp/zombies/diapi_table.csv - which M Numbers can appear with which O Number
 *
 * - Only elements.csv cols 8-19 are real; cols 20-31 are the wrong-colour
 *   decoys and are excluded.
 * - The diamond takes two numbers, not their sum: real and decoy sums overlap,
 *   the pairs don't.
 * - O Number candidates are filtered by valid M Numbers (one ambiguous case
 *   left: M 2 with TV top 19 gives 9 or 11).
 * - Diamond orientation: top = heat, left = pressure.
 */

/* [heat, pressure] per value set A-F (elements.csv cols 8-19). The five type
   "sub" ingredients in no recipe are map dressing and deliberately absent. */
const VALUE_SETS: Record<string, [number, number][]> = {
    Acetaldehyde: [[1, 7], [3, 9], [8, 1], [6, 6], [8, 4], [4, 5]],
    "Baking Soda": [[2, 9], [4, 2], [4, 4], [6, 4], [7, 6], [9, 5]],
    Detergent: [[3, 3], [9, 7], [2, 7], [4, 9], [7, 1], [4, 9]],
    Dinitro: [[4, 3], [8, 1], [7, 5], [7, 2], [6, 9], [7, 6]],
    "Drain Opener": [[7, 9], [2, 5], [6, 7], [5, 6], [5, 3], [9, 6]],
    Fat: [[7, 3], [9, 3], [2, 3], [5, 9], [7, 9], [4, 8]],
    Formaldehyde: [[8, 6], [4, 9], [9, 2], [5, 7], [9, 4], [6, 7]],
    "Glass Cleaner": [[7, 9], [3, 5], [6, 1], [9, 9], [7, 3], [1, 9]],
    Glycerol: [[2, 7], [9, 9], [7, 2], [4, 8], [9, 4], [8, 3]],
    Hexamine: [[4, 4], [8, 3], [3, 5], [2, 3], [5, 9], [3, 3]],
    Ice: [[4, 6], [1, 1], [8, 5], [4, 9], [7, 3], [2, 1]],
    "Insect Repellent": [[1, 5], [4, 3], [2, 1], [8, 4], [9, 6], [9, 7]],
    Methylbenzene: [[6, 2], [8, 4], [3, 9], [8, 2], [6, 1], [2, 9]],
    "Mixed Acid Solution": [[6, 2], [7, 9], [5, 3], [7, 8], [2, 3], [5, 7]],
    "Motor Oil": [[7, 2], [4, 5], [2, 6], [3, 6], [8, 7], [6, 8]],
    "Nail Polish Remover": [[3, 6], [8, 9], [4, 3], [3, 8], [2, 3], [5, 4]],
    "Nitrated Glycerol Solution": [[9, 5], [8, 2], [7, 6], [8, 5], [1, 8], [7, 5]],
    Paint: [[3, 2], [8, 7], [3, 5], [3, 7], [5, 2], [4, 4]],
    Pennies: [[1, 6], [7, 7], [5, 9], [8, 3], [3, 8], [1, 4]],
    Phenol: [[5, 5], [2, 9], [4, 3], [8, 5], [6, 2], [3, 4]],
    "Phenolsulfonic Acid": [[4, 9], [9, 1], [3, 6], [3, 5], [8, 9], [3, 1]],
    "Plant Food": [[5, 2], [6, 7], [9, 7], [9, 8], [9, 2], [6, 7]],
    Quarters: [[7, 5], [3, 6], [2, 6], [8, 5], [4, 1], [7, 5]],
    "Racing Fuel": [[8, 6], [3, 8], [7, 9], [1, 7], [7, 7], [5, 1]],
    Sludge: [[4, 3], [7, 1], [7, 5], [3, 8], [9, 2], [7, 8]],
    Vinegar: [[2, 4], [9, 2], [2, 9], [4, 2], [1, 4], [9, 1]],
    Vodka: [[8, 8], [9, 7], [2, 9], [1, 5], [9, 2], [7, 4]],
    "Wheel Cleaner": [[4, 9], [9, 4], [3, 7], [5, 5], [5, 1], [8, 5]],
};

/* Insect Repellent's bheat/bpressure (elements.csv cols 20-31): what the board
   shows in a wrong colour. Only used to name a wrong-colour read. */
const INSECT_DECOY_PAIRS: [number, number][] = [[5, 5], [6, 9], [9, 5], [1, 6], [7, 4], [7, 2]];

/* compounds.csv, in craft order. A part that is itself a key here has to be
   made first; register_compound() also requires the beakers you do not use to
   be left empty, which is why the ingredient count matters. */
const RECIPES: Record<string, string[]> = {
    Formaldehyde: ["Racing Fuel", "Quarters"],
    Hexamine: ["Formaldehyde", "Glass Cleaner"],
    Phenol: ["Insect Repellent", "Motor Oil", "Wheel Cleaner"],
    "Phenolsulfonic Acid": ["Phenol", "Drain Opener"],
    Acetaldehyde: ["Vodka", "Pennies"],
    Sludge: ["Formaldehyde", "Acetaldehyde", "Detergent"],
    Methylbenzene: ["Detergent", "Drain Opener", "Paint"],
    Dinitro: ["Baking Soda", "Detergent", "Vinegar", "Methylbenzene"],
    Glycerol: ["Fat", "Vodka"],
    "Mixed Acid Solution": ["Drain Opener", "Detergent", "Ice"],
    "Nitrated Glycerol Solution": ["Glycerol", "Mixed Acid Solution"],
};

interface FinalChemical {
    id: string;
    label: string;
    parts: string[];
    /** setup_final_compound() draws randomintrange(0, size - 1), and the upper
        bound is exclusive, so the last final compound in compounds.csv (nitro)
        is never the radio's answer. Kept selectable, but marked. */
    neverChosen?: boolean;
}

const FINAL_CHEMICALS: FinalChemical[] = [
    { id: "chem_1", label: "3,4-di-nitroxy-methyl-propane", parts: ["Sludge", "Nail Polish Remover"] },
    { id: "chem_2", label: "1,3,5 tera-nitro-phenol", parts: ["Phenolsulfonic Acid", "Detergent"] },
    { id: "chem_3", label: "Octa-hydro-2,5-nitro-3,4,7-para-zokine", parts: ["Hexamine", "Plant Food", "Vinegar", "Detergent"] },
    { id: "chem_4", label: "3-methyl-2,4-di-nitrobenzene", parts: ["Dinitro", "Racing Fuel"] },
    { id: "chem_5", label: "2,4-propane-3,5-tetra-nitrite", parts: ["Nitrated Glycerol Solution", "Baking Soda"], neverChosen: true },
];

/* diapi_table.csv. Column 1 is the O Number; the rest of the row is every M
   Number that can be shown with it, so the two are not independent.
   O 8 lists 20 twice in the game data - deduplicated here, same set either way. */
const O_M_PAIRS: Record<number, number[]> = {
    2: [4, 8, 12, 16, 20, 24],
    4: [3, 6, 9, 12, 15, 18],
    8: [5, 10, 15, 20, 25],
    9: [2, 4, 6, 8, 10, 12],
    11: [1, 2, 3, 4, 5, 6],
    15: [6, 12, 18, 20, 24, 30],
};

const ingredient_links: Record<string, string> = {
    "Baking Soda": "pictures/ingredients/baking_soda.webp",
    Detergent: "pictures/ingredients/detergent.webp",
    "Drain Opener": "pictures/ingredients/drain_opener.webp",
    Fat: "pictures/ingredients/fat.webp",
    "Glass Cleaner": "pictures/ingredients/glass_cleaner.webp",
    Ice: "pictures/ingredients/ice.webp",
    "Insect Repellent": "pictures/ingredients/insect.webp",
    "Motor Oil": "pictures/ingredients/motor_oil.webp",
    "Nail Polish Remover": "pictures/ingredients/nail_polish.webp",
    Paint: "pictures/ingredients/paint.webp",
    Pennies: "pictures/ingredients/pennies.webp",
    "Plant Food": "pictures/ingredients/plant_food.webp",
    Quarters: "pictures/ingredients/quarters.webp",
    "Racing Fuel": "pictures/ingredients/racing_fuel.webp",
    Vinegar: "pictures/ingredients/vinegar.webp",
    Vodka: "pictures/ingredients/vodka.webp",
    "Wheel Cleaner": "pictures/ingredients/wheel_cleaner.webp",
};

const BAND_LABELS = ["Top Colour", "Middle Colour", "Bottom Colour"];
const SET_LABELS = ["A", "B", "C", "D", "E", "F"];

interface OCandidate {
    o: number;
    tvValue: number;
    /** 0 = top band on the TV, 1 = middle, 2 = bottom. */
    band: number;
}

/**
 * The TV shows three bands around X: "< X", "X - X+2", "> X+2", so the real
 * value is X-1, X+1 or X+3. Filtered by O_M_PAIRS because select_pi_value()
 * draws the M Number from the chosen O's row.
 */
function solveO(mNum: number, tvTop: number): OCandidate[] {
    const bands = [tvTop - 1, tvTop + 1, tvTop + 3];
    const found: OCandidate[] = [];

    for (const key of Object.keys(O_M_PAIRS)) {
        const o = Number(key);
        if (!O_M_PAIRS[o].includes(mNum)) continue;
        const band = bands.indexOf(mNum * o);
        if (band === -1) continue;
        found.push({ o, tvValue: mNum * o, band });
    }

    return found.sort((a, b) => a.o - b.o);
}

type SetLookup =
    | { kind: "ok"; index: number }
    | { kind: "decoy" }
    | { kind: "unknown" };

function findValueSet(top: number, left: number): SetLookup {
    const matches = ([h, p]: [number, number]) => h === top && p === left;

    const index = VALUE_SETS["Insect Repellent"].findIndex(matches);
    if (index !== -1) return { kind: "ok", index };
    if (INSECT_DECOY_PAIRS.some(matches)) return { kind: "decoy" };
    return { kind: "unknown" };
}

interface CraftStep {
    product: string;
    ingredients: string[];
}

function craftChain(chemical: FinalChemical): CraftStep[] {
    const steps: CraftStep[] = [];
    const made = new Set<string>();

    const visit = (product: string, ingredients: string[]) => {
        if (made.has(product)) return;
        for (const part of ingredients) {
            const recipe = RECIPES[part];
            if (recipe) visit(part, recipe);
        }
        made.add(product);
        steps.push({ product, ingredients });
    };

    visit(chemical.label, chemical.parts);
    return steps;
}

/** Mirrors reaction_activation(): heat + pressure over filled beakers, minus the O Number. */
function formulaNumber(ingredients: string[], setIndex: number, oNum: number): number {
    let total = 0;
    for (const name of ingredients) {
        const [heat, pressure] = VALUE_SETS[name][setIndex];
        total += heat + pressure;
    }
    return total - oNum;
}

function parseNum(raw: string): number | null {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
}

export default function ChemicalStepSolver({ title }: { title?: string }) {
    const [mRaw, setMRaw] = useState("");
    const [tvRaw, setTvRaw] = useState("");
    const [oRaw, setORaw] = useState("");
    const [insectTopRaw, setInsectTopRaw] = useState("");
    const [insectLeftRaw, setInsectLeftRaw] = useState("");
    const [chemId, setChemId] = useState("default");

    // Raw strings, so a parsing bug stays visible in the report.
    useSolverReport("ChemicalStepSolver", () => ({
        "M number": mRaw,
        "Top number on TV": tvRaw,
        "O number": oRaw,
        "Insect repellent, top (red)": insectTopRaw,
        "Insect repellent, left (blue)": insectLeftRaw,
        "Final chemical": chemId,
    }));

    const oCandidates = useMemo(() => {
        const mNum = parseNum(mRaw);
        const tvTop = parseNum(tvRaw);
        if (mNum === null || tvTop === null || mNum === 0) return null;
        return solveO(mNum, tvTop);
    }, [mRaw, tvRaw]);

    const oIsAmbiguous = oCandidates !== null && oCandidates.length > 1;

    const chosenO = useMemo(() => {
        if (oCandidates === null || oCandidates.length === 0) return null;
        if (oCandidates.length === 1) return oCandidates[0];
        const picked = parseNum(oRaw);
        return oCandidates.find((c) => c.o === picked) ?? null;
    }, [oCandidates, oRaw]);

    /* Gated on chosenO too: the wrong-colour message names the colour, which
       is unknown if the M Number is edited back to something unsolvable. */
    const valueSet = useMemo(() => {
        if (chosenO === null) return null;
        const top = parseNum(insectTopRaw);
        const left = parseNum(insectLeftRaw);
        if (top === null || left === null) return null;
        return findValueSet(top, left);
    }, [chosenO, insectTopRaw, insectLeftRaw]);

    const setIndex = valueSet !== null && valueSet.kind === "ok" ? valueSet.index : null;
    const chemical = FINAL_CHEMICALS.find((c) => c.id === chemId) ?? null;

    const steps = useMemo(() => {
        if (chosenO === null || setIndex === null || chemical === null) return null;
        return craftChain(chemical).map((step) => ({
            ...step,
            number: formulaNumber(step.ingredients, setIndex, chosenO.o),
        }));
    }, [chosenO, setIndex, chemical]);

    const showColourStep = chosenO !== null;
    const showChemicalStep = setIndex !== null;

    /* The output shows only the next thing to act on; settled answers collapse
       into one muted line under it. */
    const diamondProblem = valueSet !== null && valueSet.kind !== "ok" ? valueSet.kind : null;
    const oRejected = oIsAmbiguous && chosenO === null && parseNum(oRaw) !== null;

    const focus =
        oCandidates === null ? "prompt"
        : oCandidates.length === 0 ? "no-o"
        : chosenO === null ? "o-choice"
        : diamondProblem !== null ? "diamond-problem"
        : steps !== null ? "formulas"
        : setIndex !== null ? "value-set"
        : "o";

    const settled: string[] = [];
    if (focus === "formulas" && setIndex !== null) {
        settled.push(`Value Set ${SET_LABELS[setIndex]}`);
    }
    if (chosenO !== null && focus !== "o") {
        settled.push(`O Number ${chosenO.o}`, `${BAND_LABELS[chosenO.band]} on the TV`);
    }

    const resetAll = () => {
        setMRaw("");
        setTvRaw("");
        setORaw("");
        setInsectTopRaw("");
        setInsectLeftRaw("");
        setChemId("default");
    };

    const recalcKey = [mRaw, tvRaw, oRaw, insectTopRaw, insectLeftRaw, chemId].join("|");

    return (
        <div className="solver-container solver-container--chemical-step">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Fill in each step as you're asked for it. If it was valid, the next step will appear. If it was wrong, you'll be show what is wrong and why.
            </p>

            <p className="solver-step-label">Step 1 - Motel Office and Elvira's TV</p>

            <div className="solver-form-row">
                <label htmlFor="chem2-m-number">M Number:</label>
                <input
                    type="text"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    id="chem2-m-number"
                    value={mRaw}
                    onInput={(e) => setMRaw((e.target as HTMLInputElement).value)}
                />
            </div>

            <div className="solver-form-row">
                <label htmlFor="chem2-tv-number">Top Number on TV (&lt; ##):</label>
                <input
                    type="text"
                    pattern="[0-9]*"
                    inputMode="numeric"
                    id="chem2-tv-number"
                    value={tvRaw}
                    onInput={(e) => setTvRaw((e.target as HTMLInputElement).value)}
                />
            </div>

            {oIsAmbiguous && (
                <div className="solver-form-row">
                    <label htmlFor="chem2-o-number">O Number (from the O boards):</label>
                    <input
                        type="text"
                        pattern="[0-9]*"
                        inputMode="numeric"
                        id="chem2-o-number"
                        value={oRaw}
                        onInput={(e) => setORaw((e.target as HTMLInputElement).value)}
                    />
                </div>
            )}

            {showColourStep && (
                <>
                    <p className="solver-step-label">Step 2 - Insect Repellent diamond, in that colour</p>

                    <div className="solver-form-row">
                        <label htmlFor="chem2-insect-top">Insect Repellent - Top number (red):</label>
                        <input
                            type="text"
                            pattern="[0-9]*"
                            inputMode="numeric"
                            id="chem2-insect-top"
                            value={insectTopRaw}
                            onInput={(e) => setInsectTopRaw((e.target as HTMLInputElement).value)}
                        />
                    </div>

                    <div className="solver-form-row">
                        <label htmlFor="chem2-insect-left">Insect Repellent - Left number (blue):</label>
                        <input
                            type="text"
                            pattern="[0-9]*"
                            inputMode="numeric"
                            id="chem2-insect-left"
                            value={insectLeftRaw}
                            onInput={(e) => setInsectLeftRaw((e.target as HTMLInputElement).value)}
                        />
                    </div>
                </>
            )}

            {showChemicalStep && (
                <>
                    <p className="solver-step-label">Step 3 - Chemical from the radio</p>

                    <div className="solver-form-row">
                        <label htmlFor="chem2-final-chemical">Final Chemical:</label>
                        <select
                            id="chem2-final-chemical"
                            value={chemId}
                            onChange={(e) => setChemId((e.target as HTMLSelectElement).value)}
                        >
                            <option value="default" disabled>Select Chemical</option>
                            {FINAL_CHEMICALS.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.neverChosen ? `${c.label} (shouldn't appear)` : c.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </>
            )}

            <div className="solver-controls">
                <button type="button" className="btn btn--solver" onClick={resetAll}>Reset</button>
            </div>

            <div className="solver-output is-recalc" key={recalcKey} aria-live="polite">
                {focus === "prompt" && (
                    <p style={{ color: "var(--color-text-muted)" }}>
                        Enter the M Number from the Motel Office and the top number on Elvira's TV.
                    </p>
                )}

                {focus === "no-o" && (
                    <p className="solver-error">
                        No valid "O" Number found for an M Number of <i>{mRaw}</i> and <i>{tvRaw}</i> on the TV. Re-check both numbers.
                    </p>
                )}

                {focus === "o-choice" && (
                    <>
                        {oRejected && (
                            <p className="solver-error">
                                {oRaw} is not one of the O Numbers that fit.
                            </p>
                        )}
                        <p>
                            Two valid "O" Numbers found: <strong>{oCandidates!.map((c) => c.o).join(" or ")}</strong>.<br />Check the four "O" locations for the one that reads "O = #" in all three colours, then enter it above.
                        </p>
                    </>
                )}

                {focus === "o" && (
                    <p>
                        <strong>O Number:</strong> {chosenO!.o}
                        <br />
                        <strong>Colour Option:</strong> {BAND_LABELS[chosenO!.band]} on the TV.
                        <br />
                        <span style={{ color: "var(--color-text-muted)" }}>
                            Change the map to that colour at the TV Station, then read the Insect Repellent diamond.
                        </span>
                    </p>
                )}

                {focus === "diamond-problem" && diamondProblem === "decoy" && (
                    <p className="solver-error">
                        The map is in the wrong colour filter. Set it to the {BAND_LABELS[chosenO!.band].toLowerCase()} from the TV and read the board again.
                    </p>
                )}

                {focus === "diamond-problem" && diamondProblem === "unknown" && (
                    <p className="solver-error">
                        No value set has Insect Repellent at top = <i>{insectTopRaw}</i> and left = <i>{insectLeftRaw}</i>. Re-check the diamond: top is the red segment, left is the blue one.
                    </p>
                )}

                {focus === "value-set" && (
                    <p>
                        <strong>Value Set:</strong> {SET_LABELS[setIndex!]}
                        <br />
                        <span style={{ color: "var(--color-text-muted)" }}>
                            Pick the chemical the radio gave you to get the formulas.
                        </span>
                    </p>
                )}

                {focus === "formulas" && (
                    <ul className="solver-formula-list">
                        {steps!.map((step, i) => (
                            <li key={step.product}>
                                <span className="solver-formula-list__name">
                                    Formula {i + 1} - make {step.product}
                                </span>
                                <span className="solver-formula-list__ingredients">
                                    {step.ingredients.map((ing, j) => (
                                        <span key={ing}>
                                            {j > 0 && " + "}
                                            {ingredient_links[ing] ? (
                                                <a href={ingredient_links[ing]}>{ing}</a>
                                            ) : (
                                                ing
                                            )}
                                        </span>
                                    ))}
                                </span>
                                <span className="solver-formula-list__number">Number: {step.number}</span>
                            </li>
                        ))}
                    </ul>
                )}

                {settled.length > 0 && (
                    <p style={{ color: "var(--color-text-muted)" }}>{settled.join(" · ")}</p>
                )}
            </div>
        </div>
    );
}
