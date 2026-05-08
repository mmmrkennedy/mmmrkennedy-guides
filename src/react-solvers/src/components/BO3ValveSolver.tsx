import { useMemo, useState } from "preact/hooks";

type ValveLocation = "department_store" | "supply_depot" | "armory" | "infirmary" | "tank_factory" | "dragon_command";

type ValveConfig = [
        number | undefined,
        number | undefined,
        number | undefined,
        number | undefined,
        number | undefined,
        number | undefined,
];

type LocationToConfigMap = Partial<Record<ValveLocation, ValveConfig>>;
type ValveLegend = Record<ValveLocation, LocationToConfigMap>;

const LOCATION_NAMES: Record<ValveLocation, string> = {
    department_store: "Department Store",
    supply_depot: "Supply Depot",
    armory: "Armory",
    infirmary: "Infirmary",
    tank_factory: "Tank Factory",
    dragon_command: "Dragon Command",
};

const LOCATION_ORDER: ValveLocation[] = [
    "department_store",
    "supply_depot",
    "armory",
    "infirmary",
    "tank_factory",
    "dragon_command",
];

const valveLegend: ValveLegend = {
    department_store: {
        supply_depot: [1, undefined, 2, 3, 1, 1],
        armory: [3, 2, undefined, 2, 2, 3],
        infirmary: [3, 2, 2, undefined, 1, 1],
        tank_factory: [2, 2, 2, 3, undefined, 1],
        dragon_command: [2, 1, 1, 2, 3, undefined],
    },
    supply_depot: {
        department_store: [undefined, 1, 3, 2, 3, 3],
        armory: [3, 2, undefined, 2, 2, 3],
        infirmary: [3, 2, 2, undefined, 1, 1],
        tank_factory: [2, 2, 2, 3, undefined, 1],
        dragon_command: [2, 1, 1, 2, 3, undefined],
    },
    armory: {
        department_store: [undefined, 3, 1, 3, 1, 2],
        supply_depot: [3, undefined, 2, 1, 1, 1],
        infirmary: [2, 1, 2, undefined, 2, 2],
        tank_factory: [2, 3, 3, 3, undefined, 1],
        dragon_command: [2, 1, 3, 2, 2, undefined],
    },
    infirmary: {
        department_store: [undefined, 3, 3, 3, 3, 1],
        supply_depot: [1, undefined, 2, 3, 2, 2],
        armory: [1, 1, undefined, 2, 2, 2],
        tank_factory: [1, 3, 1, 3, undefined, 2],
        dragon_command: [3, 2, 2, 2, 2, undefined],
    },
    tank_factory: {
        department_store: [undefined, 2, 3, 3, 1, 1],
        supply_depot: [1, undefined, 1, 3, 1, 2],
        armory: [3, 2, undefined, 1, 1, 1],
        infirmary: [3, 2, 2, undefined, 2, 3],
        dragon_command: [1, 1, 1, 1, 1, undefined],
    },
    dragon_command: {
        department_store: [undefined, 2, 2, 1, 1, 1],
        supply_depot: [2, undefined, 1, 2, 3, 2],
        armory: [1, 3, undefined, 1, 1, 1],
        infirmary: [2, 3, 3, undefined, 3, 1],
        tank_factory: [1, 3, 1, 1, undefined, 3],
    },
};

interface ValveAdjustment {
    location: string;
    value: number;
}

type ValveResult =
    | { kind: "ok"; adjustments: ValveAdjustment[] }
    | { kind: "error"; reason: string };

function getAdjustments(green: ValveLocation, pink: ValveLocation): ValveResult {
    if (green === pink) {
        return { kind: "error", reason: "The Green and Pink Valves can't be at the same location." };
    }

    const config = valveLegend[green]?.[pink];
    if (!config) {
        return { kind: "error", reason: "Unable to look up the valve configuration. Please try again." };
    }

    const adjustments: ValveAdjustment[] = [];
    for (let i = 0; i < config.length; i++) {
        const value = config[i];
        if (value === undefined || value === 0) continue;
        adjustments.push({
            location: LOCATION_NAMES[LOCATION_ORDER[i]],
            value,
        });
    }
    return { kind: "ok", adjustments };
}

export default function BO3ValveSolver({ title }: { title?: string }) {
    const [greenValve, setGreenValve] = useState<ValveLocation>("department_store");
    const [pinkValve, setPinkValve] = useState<ValveLocation>("supply_depot");

    const result = useMemo(() => getAdjustments(greenValve, pinkValve), [greenValve, pinkValve]);

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Pick the locations of the <span className="solver-text--green">Green Light Valve</span> and the{" "}
                <span className="solver-text--pink">Pink Cylinder Valve</span>. The solver will show which valves to
                adjust and their target settings.
            </p>

            <div className="solver-form-row">
                <label htmlFor="greenValve">
                    <span className="solver-text--green">Green Light Valve:</span>
                </label>
                <select
                    id="greenValve"
                    value={greenValve}
                    onChange={(e) => setGreenValve((e.currentTarget as HTMLSelectElement).value as ValveLocation)}
                >
                    {LOCATION_ORDER.map((loc) => (
                        <option key={loc} value={loc}>{LOCATION_NAMES[loc]}</option>
                    ))}
                </select>
            </div>

            <div className="solver-form-row">
                <label htmlFor="pinkValve">
                    <span className="solver-text--pink">Pink Cylinder Valve:</span>
                </label>
                <select
                    id="pinkValve"
                    value={pinkValve}
                    onChange={(e) => setPinkValve((e.currentTarget as HTMLSelectElement).value as ValveLocation)}
                >
                    {LOCATION_ORDER.map((loc) => (
                        <option key={loc} value={loc}>{LOCATION_NAMES[loc]}</option>
                    ))}
                </select>
            </div>

            <div className="solver-output is-recalc" aria-live="polite">
                {result.kind === "error" ? (
                    <p className="solver-error">{result.reason}</p>
                ) : (
                    result.adjustments.map((adj, i) => (
                        <p key={i}>
                            Set <strong>{adj.location}</strong> to {adj.value}
                        </p>
                    ))
                )}
            </div>
        </div>
    );
}