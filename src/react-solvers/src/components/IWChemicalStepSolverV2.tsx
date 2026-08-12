import { useMemo, useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

/*
 * Rebuild of IWChemicalStepSolver.tsx. Both are mounted on the dev page so they
 * can be driven side by side; the original is untouched.
 *
 * Every table below is generated from the shipped game tables instead of being
 * transcribed from gameplay:
 *   cp/zombies/elements.csv    - heat/pressure per value set (cols 8-19)
 *   cp/zombies/compounds.csv   - what each compound is made from
 *   cp/zombies/diapi_table.csv - which M Numbers can appear with which O Number
 *
 * Three differences from the original that change answers, each checked against
 * scripts/cp/maps/cp_town/cp_town_chemistry.gsc:
 *
 * 1. The old table carried twelve columns per ingredient; only six can ever be
 *    the answer. reaction_activation() reads elements.csv cols 8-19 and nothing
 *    else. Cols 20-31 are bheatA-bpressureF: the decoy numbers the boards show
 *    while the map is in the WRONG colour (colorsquares.lua,
 *    UpdateBadHeatNumbers). A formula built from those is rejected by the
 *    reaction, which costs 95% of your health.
 *
 * 2. The diamond is entered as two numbers rather than their sum. The six real
 *    Insect Repellent pairs and the six decoy pairs share no member, so a
 *    wrong-colour read is always caught; their sums do overlap (7 and 15 appear
 *    in both), so summing first silently accepts two reads out of six.
 *
 * 3. O Number candidates are filtered by the M Numbers that can actually occur
 *    with them. That leaves one genuinely ambiguous case (M 2 against a TV top
 *    of 19: 9 or 11) instead of eight.
 *
 * Orientation of the diamond - top = heat, left = pressure - is from
 * pictures/main_ee/chem_diamond_solver.webp: that shot is in full colour, so
 * both diamonds in it are decoys, and Racing Fuel 3/2 with Insect Repellent 7/4
 * is bheatE/bpressureE for both. Only that reading puts them in the same column.
 */

/* [heat, pressure] per value set A-F, in elements.csv order (cols 8-19).
   Every ingredient reachable through a recipe is here; the five that appear in
   no recipe (Food Coloring, Pool Cleaner, Bleach, Powdered Milk, Table Salt -
   type "sub" in elements.csv) are map dressing and are deliberately absent. */
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

/* Insect Repellent's bheat/bpressure pairs (elements.csv cols 20-31): what the
   board shows when the map is in a colour that is not the answer. Held only so
   a wrong-colour read can be named as one. */
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
}

const FINAL_CHEMICALS: FinalChemical[] = [
    { id: "chem_1", label: "3,4-di-nitroxy-methyl-propane", parts: ["Sludge", "Nail Polish Remover"] },
    { id: "chem_2", label: "1,3,5 tera-nitro-phenol", parts: ["Phenolsulfonic Acid", "Detergent"] },
    { id: "chem_3", label: "Octa-hydro-2,5-nitro-3,4,7-para-zokine", parts: ["Hexamine", "Plant Food", "Vinegar", "Detergent"] },
    { id: "chem_4", label: "3-methyl-2,4-di-nitrobenzene", parts: ["Dinitro", "Racing Fuel"] },
    { id: "chem_5", label: "2,4-propane-3,5-tetra-nitrite", parts: ["Nitrated Glycerol Solution", "Baking Soda"] },
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
 * O Numbers that fit an M Number and the TV.
 *
 * The TV shows three bands built around one number: "< X", "X - X+2", "> X+2".
 * X is the number the guide asks for, and the real value sits one under, one
 * over, or three over it depending on which band it landed in.
 *
 * Candidates are also filtered by O_M_PAIRS, because select_pi_value() draws
 * the M Number from the row belonging to the chosen O.
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

/** Identify the value set from Insect Repellent's top and left numbers. */
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

/** Expand a final chemical into the compounds you have to make, in order. */
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

/**
 * What to punch into the machine for one formula.
 *
 * reaction_activation() sums heat and pressure across every filled beaker for
 * the chosen value set, then subtracts the O Number - so this is the same sum,
 * with the diamond's two numbers standing in for heat and pressure.
 */
function formulaNumber(ingredients: string[], setIndex: number, oNum: number): number {
    let total = 0;
    for (const name of ingredients) {
        const [heat, pressure] = VALUE_SETS[name][setIndex];
        total += heat + pressure;
    }
    return total - oNum;
}

/** Digits only; blank and junk both read as "not answered yet". */
function parseNum(raw: string): number | null {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
}

export default function IWChemicalStepSolverV2({ title }: { title?: string }) {
    const [mRaw, setMRaw] = useState("");
    const [tvRaw, setTvRaw] = useState("");
    const [oRaw, setORaw] = useState("");
    const [insectTopRaw, setInsectTopRaw] = useState("");
    const [insectLeftRaw, setInsectLeftRaw] = useState("");
    const [chemId, setChemId] = useState("default");

    // The raw strings, not the parsed numbers: "07" and "7" are the same number
    // but not the same thing typed, and a parsing bug would be invisible in the
    // parsed form.
    useSolverReport("ChemicalStepSolver", () => ({
        "M number": mRaw,
        "Top number on TV": tvRaw,
        "O number": oRaw,
        "Insect repellent, top (red)": insectTopRaw,
        "Insect repellent, left (blue)": insectLeftRaw,
        "Final chemical": chemId,
    }));

    /* Everything below is derived. There is no Calculate button and no
       per-field "is this visible yet" flag: a step appears once the step above
       it has an answer, so the two can never disagree. */
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

    /* Gated on the O Number as well as on its own two fields: the diamond only
       means anything once you know which colour to read it in, and the
       wrong-colour message below names that colour. Without this, editing the M
       Number back to something unsolvable after filling the diamond in would
       leave the colour unknown while the message still tried to name it. */
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

    /* The output panel shows one thing in full - whatever you have to act on
       next - with everything already settled collapsed into a single muted line
       under it. Reading top-down, that puts the newest answer first and stops
       step 3 from sitting under two paragraphs of step 1 and 2 leftovers.
       It is also what retires each step's "now go and do this" hint: the hint
       lives in the focus block, so answering the step drops it. */
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

    /* Settled facts, newest first. Empty while step 1 is still the focus. */
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
                Fill in each step as you go - the next one appears once the answer above it is settled, and the results update as you type.
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
                                <option key={c.id} value={c.id}>{c.label}</option>
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
                        No O Number fits an M Number of {mRaw} against {tvRaw} on the TV. Re-check both numbers - the TV number is the one on the "&lt; ##" line.
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
                            Two O Numbers fit: <strong>{oCandidates!.map((c) => c.o).join(" or ")}</strong>. Check the four O board locations for the one that reads "O = #" in all three colours, then enter it above.
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
                        Those are decoy numbers - the map is in the wrong colour. Set it to the {BAND_LABELS[chosenO!.band].toLowerCase()} from the TV and read the board again.
                    </p>
                )}

                {focus === "diamond-problem" && diamondProblem === "unknown" && (
                    <p className="solver-error">
                        No value set has Insect Repellent at top {insectTopRaw} / left {insectLeftRaw}. Re-check the diamond: top is the red segment, left is the blue one - ignore the yellow and white numbers.
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
