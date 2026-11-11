/**
 * Solvers publish the reader's inputs so a flag can be reproduced; state isn't
 * recoverable from the DOM. Publish inputs only, nothing derived, as plain JSON.
 * `useSolverReport` is a no-op without a <SolverReportRoot> (added by main.tsx on hydrate).
 */
import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";

/** JSON-serializable values keyed by a human label. */
export type SolverInputs = Record<string, unknown>;

interface Registration {
    name: string;
    read: () => SolverInputs;
}

const registry = new WeakMap<HTMLElement, Registration>();

const RootContext = createContext<HTMLElement | null>(null);

// Must render no DOM: it wraps hydrate(), and the SSR markup has no element for it.
export function SolverReportRoot({
    element,
    children,
}: {
    element: HTMLElement;
    children: ComponentChildren;
}) {
    return <RootContext.Provider value={element}>{children}</RootContext.Provider>;
}

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

// Null on a throwing reader too, so the caller falls back to scraping the DOM.
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
