/**
 * Sets up solver button functionality
 * Handles toggle behavior for solver containers
 */
function setupSolverButtons() {
    const solver_button_divs = document.getElementsByClassName("solver-with-button");

    if (!solver_button_divs.length) return;

    for (const solver_button_div of solver_button_divs) {
        const toggle_button = solver_button_div.querySelector(".in-line-button");
        const nested_container = solver_button_div.querySelector("div");

        if (!toggle_button || !nested_container) continue;

        toggle_button.addEventListener("click", () => {
            toggle_button.classList.toggle("active");
            nested_container.style.display = toggle_button.classList.contains("active") ? "block" : "none";
        });
    }
}


// Make functions available globally
window.LinkProcessor = {
    setupSolverButtons,
};
