/**
 * Solver input reporting
 * ----------------------
 * Each solver publishes the inputs the reader actually gave it, so a flag filed
 * from that solver carries the state that produced the disputed answer.
 *
 * WHY NOT READ THE DOM
 *
 * A solver is a pure function of its inputs: same inputs, same answer, every
 * time. So the answer is worth nothing in a bug report — the inputs are the
 * whole report, and reproducing one means having them exactly as they were
 * entered. The DOM only shows a faithful copy of those inputs for the solvers
 * built out of labelled form controls. The reactor grid, the queens board and
 * the venom maze keep theirs in component state and paint the result (in one
 * case to a <canvas>), so scraping the page recovers nothing about them. Only
 * the component can say what it was given.
 *
 * WHAT TO PUBLISH
 *
 * Inputs, and nothing derived from them. Not the answer, not an error message,
 * not "which of the 4 solutions is on screen" — all of that follows from the
 * inputs and can be recomputed by typing them back into the solver. Values are
 * whatever JSON says it best: a number, a string, an array of coordinates.
 *
 * CONTRACT
 *
 * `useSolverReport` is a no-op unless a <SolverReportRoot> is above it, which
 * main.tsx adds while hydrating. That keeps the server prerender (ssr-entry.tsx,
 * no provider) and the dev harness working untouched, and means a solver can be
 * rendered anywhere without needing this to exist.
 */
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";

/** A solver's inputs: any JSON-serializable value, keyed by a human label. */
export type SolverInputs = Record<string, unknown>;

interface Registration {
    name: string;
    read: () => SolverInputs;
}

/**
 * Mount root -> its solver's reader. Weak so a removed solver's state cannot be
 * held alive by this map; the effect cleanup below is the ordinary path, this is
 * the safety net.
 */
const registry = new WeakMap<HTMLElement, Registration>();

/** The mount element the surrounding solver was hydrated into. */
const RootContext = createContext<HTMLElement | null>(null);

/**
 * Renders no DOM of its own — deliberately. It wraps the solver during hydrate(),
 * and an element here would be an element Preact expects in markup the SSR build
 * never produced.
 */
export function SolverReportRoot({
    element,
    children,
}: {
    element: HTMLElement;
    children: ComponentChildren;
}) {
    return <RootContext.Provider value={element}>{children}</RootContext.Provider>;
}

/**
 * Publish this solver's current inputs under `name`.
 *
 * `read` is re-read through a ref on every render rather than captured once, so
 * the registry always calls the newest closure and can never hand back the state
 * a solver had when it first mounted.
 */
export function useSolverReport(name: string, read: () => SolverInputs): void {
    const root = useContext(RootContext);
    const latest = useRef(read);
    latest.current = read;

    useEffect(() => {
        if (!root) return;
        registry.set(root, { name, read: () => latest.current() });
        return () => {
            registry.delete(root);
        };
    }, [root, name]);
}

/**
 * Read a mounted solver's inputs. Returns null when that root has no solver, or
 * when the solver's own reader throws — a broken reader must not be able to stop
 * a reader from filing a report, so the caller falls back to scraping the DOM.
 */
export function readSolverInputs(
    root: HTMLElement,
): { name: string; inputs: SolverInputs } | null {
    const registration = registry.get(root);
    if (!registration) return null;
    try {
        return { name: registration.name, inputs: registration.read() };
    } catch {
        return null;
    }
}
