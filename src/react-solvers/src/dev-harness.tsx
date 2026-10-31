/// <reference types="vite/client" />
// Development preview only — the "All Solvers" page at src/react-solvers/index.html.
//
// This file loads every solver up front because it renders them all at once.
// Keeping it out of main.tsx means they end up in a chunk that only the dev page
// loads, instead of in the entry that every guide on the site downloads.
//
// main.tsx imports this dynamically, guarded on #root existing.

import { render } from "preact";
import type { ComponentType } from "preact";

// import: "default" matters. Without it Vite imports each whole module, and the
// solver chunks lose the manifest entries eleventy preloads them by.
const modules = import.meta.glob<ComponentType<Record<string, unknown>>>("./components/*.tsx", {
    eager: true,
    import: "default",
});
const solvers = Object.entries(modules).map(([file, Solver]) => ({
    name: file.replace(/^.*\/|\.tsx$/g, ""),
    Solver,
}));
const SimonSaysSolver = modules["./components/SimonSaysSolver.tsx"];
const MorseSolver = modules["./components/BeastVenomYMorseSolver.tsx"];

const devRoot = document.getElementById("root");
if (devRoot) {
    render(
        <div>
            {solvers
                .filter(({ name }) => name !== "SimonSaysSolver")
                .map(({ name, Solver }) => (
                    <Solver key={name} title={name} />
                ))}
            <MorseSolver title="BeastVenomYMorseSolver (key from dropdown)" keySelectId="venom-y-key-selector" />
            {/* Configured per page rather than per map, so several are shown: the
                four-pad case every simon-says puzzle starts from, and a wider
                palette to check the pads and the slots still wrap. */}
            <SimonSaysSolver title="Simon Says Solver (4 colours)" colours={["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"]} />
            <SimonSaysSolver
                title="Simon Says Solver (7 colours)"
                colours={["#e74c3c", "#e87500", "#f1c40f", "#2ecc71", "#5dade2", "#8b2fc9", "#ecf0f1"]}
            />
            {/* Fixed layout: no Arrange button, and no move arrows to reach. */}
            <SimonSaysSolver
                title="Simon Says Solver (fixed layout)"
                colours={["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"]}
                canArrange={false}
            />
            {/* Named pads, including one left blank to fall back to its colour. */}
            <SimonSaysSolver
                title="Simon Says Solver (named pads)"
                colours={["#daf7f7", "#aafcff", "#f8eec5", "#ed9bf7"]}
                names={["Bar", "Atrium", "", "Vault"]}
            />
        </div>,
        devRoot,
    );
}
