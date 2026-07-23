import { useMemo, useState } from "preact/hooks";

interface ElementObj {
    symbol: string;
    name: string;
    number: number;
}

const periodicElements: ElementObj[] = [
    { symbol: "H", name: "Hydrogen", number: 1 },
    { symbol: "He", name: "Helium", number: 2 },
    { symbol: "Li", name: "Lithium", number: 3 },
    { symbol: "Be", name: "Beryllium", number: 4 },
    { symbol: "B", name: "Boron", number: 5 },
    { symbol: "C", name: "Carbon", number: 6 },
    { symbol: "N", name: "Nitrogen", number: 7 },
    { symbol: "O", name: "Oxygen", number: 8 },
    { symbol: "F", name: "Fluorine", number: 9 },
    { symbol: "Ne", name: "Neon", number: 10 },
    { symbol: "Na", name: "Sodium", number: 11 },
    { symbol: "Mg", name: "Magnesium", number: 12 },
    { symbol: "Al", name: "Aluminum", number: 13 },
    { symbol: "Si", name: "Silicon", number: 14 },
    { symbol: "P", name: "Phosphorus", number: 15 },
    { symbol: "S", name: "Sulfur", number: 16 },
    { symbol: "Cl", name: "Chlorine", number: 17 },
    { symbol: "Ar", name: "Argon", number: 18 },
    { symbol: "K", name: "Potassium", number: 19 },
    { symbol: "Ca", name: "Calcium", number: 20 },
    { symbol: "Sc", name: "Scandium", number: 21 },
    { symbol: "Ti", name: "Titanium", number: 22 },
    { symbol: "V", name: "Vanadium", number: 23 },
    { symbol: "Cr", name: "Chromium", number: 24 },
    { symbol: "Mn", name: "Manganese", number: 25 },
    { symbol: "Fe", name: "Iron", number: 26 },
    { symbol: "Co", name: "Cobalt", number: 27 },
    { symbol: "Ni", name: "Nickel", number: 28 },
    { symbol: "Cu", name: "Copper", number: 29 },
    { symbol: "Zn", name: "Zinc", number: 30 },
    { symbol: "Ga", name: "Gallium", number: 31 },
    { symbol: "Ge", name: "Germanium", number: 32 },
    { symbol: "As", name: "Arsenic", number: 33 },
    { symbol: "Se", name: "Selenium", number: 34 },
    { symbol: "Br", name: "Bromine", number: 35 },
    { symbol: "Kr", name: "Krypton", number: 36 },
    { symbol: "Rb", name: "Rubidium", number: 37 },
    { symbol: "Sr", name: "Strontium", number: 38 },
    { symbol: "Y", name: "Yttrium", number: 39 },
    { symbol: "Zr", name: "Zirconium", number: 40 },
    { symbol: "Nb", name: "Niobium", number: 41 },
    { symbol: "Mo", name: "Molybdenum", number: 42 },
    { symbol: "Tc", name: "Technetium", number: 43 },
    { symbol: "Ru", name: "Ruthenium", number: 44 },
    { symbol: "Rh", name: "Rhodium", number: 45 },
    { symbol: "Pd", name: "Palladium", number: 46 },
    { symbol: "Ag", name: "Silver", number: 47 },
    { symbol: "Cd", name: "Cadmium", number: 48 },
    { symbol: "In", name: "Indium", number: 49 },
    { symbol: "Sn", name: "Tin", number: 50 },
    { symbol: "Sb", name: "Antimony", number: 51 },
    { symbol: "Te", name: "Tellurium", number: 52 },
    { symbol: "I", name: "Iodine", number: 53 },
    { symbol: "Xe", name: "Xenon", number: 54 },
    { symbol: "Cs", name: "Cesium", number: 55 },
    { symbol: "Ba", name: "Barium", number: 56 },
    { symbol: "La", name: "Lanthanum", number: 57 },
    { symbol: "Ce", name: "Cerium", number: 58 },
    { symbol: "Pr", name: "Praseodymium", number: 59 },
    { symbol: "Nd", name: "Neodymium", number: 60 },
    { symbol: "Pm", name: "Promethium", number: 61 },
    { symbol: "Sm", name: "Samarium", number: 62 },
    { symbol: "Eu", name: "Europium", number: 63 },
    { symbol: "Gd", name: "Gadolinium", number: 64 },
    { symbol: "Tb", name: "Terbium", number: 65 },
    { symbol: "Dy", name: "Dysprosium", number: 66 },
    { symbol: "Ho", name: "Holmium", number: 67 },
    { symbol: "Er", name: "Erbium", number: 68 },
    { symbol: "Tm", name: "Thulium", number: 69 },
    { symbol: "Yb", name: "Ytterbium", number: 70 },
    { symbol: "Lu", name: "Lutetium", number: 71 },
    { symbol: "Hf", name: "Hafnium", number: 72 },
    { symbol: "Ta", name: "Tantalum", number: 73 },
    { symbol: "W", name: "Tungsten", number: 74 },
    { symbol: "Re", name: "Rhenium", number: 75 },
    { symbol: "Os", name: "Osmium", number: 76 },
    { symbol: "Ir", name: "Iridium", number: 77 },
    { symbol: "Pt", name: "Platinum", number: 78 },
    { symbol: "Au", name: "Gold", number: 79 },
    { symbol: "Hg", name: "Mercury", number: 80 },
    { symbol: "Tl", name: "Thallium", number: 81 },
    { symbol: "Pb", name: "Lead", number: 82 },
    { symbol: "Bi", name: "Bismuth", number: 83 },
    { symbol: "Po", name: "Polonium", number: 84 },
    { symbol: "At", name: "Astatine", number: 85 },
    { symbol: "Rn", name: "Radon", number: 86 },
    { symbol: "Fr", name: "Francium", number: 87 },
    { symbol: "Ra", name: "Radium", number: 88 },
    { symbol: "Ac", name: "Actinium", number: 89 },
    { symbol: "Th", name: "Thorium", number: 90 },
    { symbol: "Pa", name: "Protactinium", number: 91 },
    { symbol: "U", name: "Uranium", number: 92 },
    { symbol: "Np", name: "Neptunium", number: 93 },
    { symbol: "Pu", name: "Plutonium", number: 94 },
    { symbol: "Am", name: "Americium", number: 95 },
    { symbol: "Cm", name: "Curium", number: 96 },
    { symbol: "Bk", name: "Berkelium", number: 97 },
    { symbol: "Cf", name: "Californium", number: 98 },
    { symbol: "Es", name: "Einsteinium", number: 99 },
    { symbol: "Fm", name: "Fermium", number: 100 },
    { symbol: "Md", name: "Mendelevium", number: 101 },
    { symbol: "No", name: "Nobelium", number: 102 },
    { symbol: "Lr", name: "Lawrencium", number: 103 },
    { symbol: "Rf", name: "Rutherfordium", number: 104 },
    { symbol: "Db", name: "Dubnium", number: 105 },
    { symbol: "Sg", name: "Seaborgium", number: 106 },
    { symbol: "Bh", name: "Bohrium", number: 107 },
    { symbol: "Hs", name: "Hassium", number: 108 },
    { symbol: "Mt", name: "Meitnerium", number: 109 },
    { symbol: "Ds", name: "Darmstadtium", number: 110 },
    { symbol: "Rg", name: "Roentgenium", number: 111 },
    { symbol: "Cn", name: "Copernicium", number: 112 },
    { symbol: "Nh", name: "Nihonium", number: 113 },
    { symbol: "Fl", name: "Flerovium", number: 114 },
    { symbol: "Mc", name: "Moscovium", number: 115 },
    { symbol: "Lv", name: "Livermorium", number: 116 },
    { symbol: "Ts", name: "Tennessine", number: 117 },
    { symbol: "Og", name: "Oganesson", number: 118 },
];

function formatElementNumber(n: number): string {
    return "#" + n.toString().padStart(3, "0");
}

interface FilterResult {
    exact: ElementObj[];
    possible: ElementObj[];
}

function filterElements(input: string): FilterResult {
    if (input === "") return { exact: [], possible: [] };

    const lower = input.toLowerCase();
    const reversed = lower.split("").reverse().join("");

    const exact: ElementObj[] = [];
    const possible: ElementObj[] = [];

    for (const el of periodicElements) {
        const sym = el.symbol.toLowerCase();
        if (sym === lower || sym === reversed) {
            exact.push(el);
        } else if (sym.includes(lower)) {
            possible.push(el);
        }
    }

    return { exact, possible };
}

function ElementList({ items }: { items: ElementObj[] }) {
    return (
        <ul className="solver-result-list">
            {items.map((el) => (
                <li key={el.symbol}>
                    <span className="solver-result-list__key">{el.symbol}</span>
                    <span className="solver-result-list__descriptor">{el.name}</span>
                    <span className="solver-result-list__meta">{formatElementNumber(el.number)}</span>
                </li>
            ))}
        </ul>
    );
}

export default function BO6PeriodicTableSolver({ title }: { title?: string }) {
    const [input, setInput] = useState<string>("");
    const result = useMemo(() => filterElements(input), [input]);

    const hasResults = result.exact.length + result.possible.length > 0;

    return (
        <div className="solver-container solver-container--periodic">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Type 1 or 2 letters from the in-game monitor(s). The solver automatically searches for matching elements. Exact matches show first, followed by partial matches.
            </p>

            <div className="solver-form-row">
                <label htmlFor="element-input">Element letters:</label>
                <input
                    type="text"
                    pattern="[^0-9]*"
                    id="element-input"
                    placeholder="e.g. H, He, Cf"
                    maxLength={2}
                    value={input}
                    onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
                    autocomplete="off"
                    spellcheck={false}
                />
            </div>

            <div className="solver-output" aria-live="polite">
                {input === "" ? (
                    <p style={{ color: "var(--color-text-muted)" }}>Enter letters to search.</p>
                ) : !hasResults ? (
                    <p className="solver-word-list--empty">No matches.</p>
                ) : (
                    <>
                        {result.exact.length > 0 && (
                            <div className="solver-result-section">
                                <p className="solver-result-section__heading">
                                    Exact matches ({result.exact.length})
                                </p>
                                <ElementList items={result.exact} />
                            </div>
                        )}
                        {result.possible.length > 0 && (
                            <div className="solver-result-section">
                                <p className="solver-result-section__heading">
                                    Possible matches ({result.possible.length})
                                </p>
                                <ElementList items={result.possible} />
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}