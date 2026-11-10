import { useMemo, useState } from "preact/hooks";
import { useSolverReport } from "../solver-report";

type ValveLocation = "department_store" | "supply_depot" | "armory" | "infirmary" | "tank_factory" | "dragon_command";

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

/** Hand-checked positions for every Green and Pink pair, in dropdown order
 (undefined for the Pink valve). The route search below picks whichever of the
 two valid routes this table lists, and falls back to it if the search fails. */
type ValveConfig = (number | undefined)[];

const valveLegend: Record<ValveLocation, Partial<Record<ValveLocation, ValveConfig>>> = {
    department_store: {
        supply_depot: [1, undefined, 2, 3, 1, 1],
        armory: [3, 2, undefined, 2, 2, 3],
        infirmary: [3, 2, 2, undefined, 1, 1],
        tank_factory: [2, 2, 2, 3, undefined, 1],
        dragon_command: [2, 1, 1, 2, 3, undefined],
    },
    supply_depot: {
        department_store: [undefined, 1, 3, 2, 3, 3],
        armory: [2, 1, undefined, 2, 3, 2],
        infirmary: [1, 1, 2, undefined, 1, 2],
        tank_factory: [1, 1, 2, 1, undefined, 3],
        dragon_command: [3, 2, 2, 1, 1, undefined],
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
        dragon_command: [3, 2, 3, 2, 2, undefined],
    },
    tank_factory: {
        department_store: [undefined, 2, 3, 3, 1, 1],
        supply_depot: [1, undefined, 1, 3, 1, 2],
        armory: [3, 2, undefined, 1, 1, 1],
        infirmary: [3, 2, 3, undefined, 2, 3],
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

// Where each valve's settings 1, 2 and 3 send the air, from function_af4b355b in
// zm_stalingrad_ee_main.gsc. The script calls Supply Depot "library" and the
// Infirmary "barracks".
const VALVE_LINKS: Record<ValveLocation, ValveLocation[]> = {
    department_store: ["armory", "infirmary", "dragon_command"],
    supply_depot: ["dragon_command", "armory", "tank_factory"],
    armory: ["supply_depot", "tank_factory", "department_store"],
    infirmary: ["department_store", "tank_factory", "dragon_command"],
    tank_factory: ["infirmary", "supply_depot", "armory"],
    dragon_command: ["supply_depot", "department_store", "infirmary"],
};

/** The puzzle is solved when the air from the Green valve passes through every
 valve once and ends at the Pink one. Returns every such route, valve by valve. */
function findRoutes(route: ValveLocation[], pink: ValveLocation): ValveLocation[][] {
    const current = route[route.length - 1];
    if (route.length === LOCATION_ORDER.length) {
        return current === pink ? [route] : [];
    }
    return VALVE_LINKS[current]
        .filter((next) => !route.includes(next))
        .flatMap((next) => findRoutes([...route, next], pink));
}

/** A route as valve positions, in dropdown order (undefined for the Pink valve). */
function routeToConfig(route: ValveLocation[]): ValveConfig {
    return LOCATION_ORDER.map((location) => {
        const i = route.indexOf(location);
        return i === route.length - 1 ? undefined : VALVE_LINKS[location].indexOf(route[i + 1]) + 1;
    });
}

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

    const table = valveLegend[green]?.[pink];
    const configs = findRoutes([green], pink).map(routeToConfig);
    const matching = configs.find((c) => table && c.every((value, i) => value === table[i]));
    if (!matching) {
        console.warn(
            `ValveSolver: the route search and the table disagree for ${green} -> ${pink}.`,
            { table, search: configs },
        );
    }

    const config = matching ?? table ?? configs[0];
    if (!config) {
        return { kind: "error", reason: "Unable to work out the valve positions. Please try again." };
    }

    const adjustments: ValveAdjustment[] = [];
    config.forEach((value, i) => {
        if (value !== undefined) {
            adjustments.push({ location: LOCATION_NAMES[LOCATION_ORDER[i]], value });
        }
    });
    return { kind: "ok", adjustments };
}

export default function ValveSolver({ title }: { title?: string }) {
    const [greenValve, setGreenValve] = useState<ValveLocation>("department_store");
    const [pinkValve, setPinkValve] = useState<ValveLocation>("supply_depot");

    useSolverReport("ValveSolver", () => ({
        "Green light valve": LOCATION_NAMES[greenValve],
        "Pink cylinder valve": LOCATION_NAMES[pinkValve],
    }));

    const result = useMemo(() => getAdjustments(greenValve, pinkValve), [greenValve, pinkValve]);

    return (
        <div className="solver-container">
            {title && <h2 className="solver-title">{title}</h2>}
            <p className="solver-instructions">
                Pick the locations of the <span className="solver-text--green">Green Light Valve</span> and the{" "} <span className="solver-text--pink">Pink Cylinder Valve</span>. The solver will show the required positions of each valve.
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