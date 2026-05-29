/**
 * Sets up solver button functionality
 * Handles toggle behavior for solver containers
 */
function setupSolverButtons(): void {
    const solverButtonDivs = document.getElementsByClassName("solver-with-button");
    if (!solverButtonDivs.length) return;

    for (const solverButtonDiv of solverButtonDivs) {
        const toggleButton = solverButtonDiv.querySelector<HTMLElement>(".in-line-button");
        const nestedContainer = solverButtonDiv.querySelector<HTMLElement>("div");
        if (!toggleButton || !nestedContainer) continue;

        toggleButton.addEventListener("click", () => {
            toggleButton.classList.toggle("active");
            nestedContainer.style.display = toggleButton.classList.contains("active") ? "none" : "block";
        });
    }
}

// Make functions available globally
window.LinkProcessor = {
    setupSolverButtons,
};
