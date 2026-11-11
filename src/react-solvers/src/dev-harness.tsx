/// <reference types="vite/client" />
// Dev-only "All Solvers" page (src/react-solvers/index.html). Kept out of main.tsx
// so eager-loading every solver doesn't land in the entry every guide downloads.

import { render } from "preact";
import type { ComponentType } from "preact";

// import: "default" is required, or the solver chunks lose the manifest entries
// eleventy preloads them by.
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
            <SimonSaysSolver title="Simon Says Solver (4 colours)" colours={["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"]} />
            <SimonSaysSolver
                title="Simon Says Solver (7 colours)"
                colours={["#e74c3c", "#e87500", "#f1c40f", "#2ecc71", "#5dade2", "#8b2fc9", "#ecf0f1"]}
            />
            <SimonSaysSolver
                title="Simon Says Solver (fixed layout)"
                colours={["#e74c3c", "#2ecc71", "#5dade2", "#f1c40f"]}
                canArrange={false}
            />
            <SimonSaysSolver
                title="Simon Says Solver (named pads)"
                colours={["#daf7f7", "#aafcff", "#f8eec5", "#ed9bf7"]}
                names={["Bar", "Atrium", "", "Vault"]}
            />
        </div>,
        devRoot,
    );
}
