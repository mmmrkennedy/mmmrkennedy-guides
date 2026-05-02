function initRevealButtons() {
    document.querySelectorAll("[data-reveal-label]").forEach((div) => {
        div.querySelector("button").addEventListener("click", function() {
            const content = div.querySelector(".button-activated-div");
            content.style.display = content.style.display === "none" ? "block" : "none";
        });
    });
}

// Make functions available globally
window.SolverButtonProcessor = {
    initRevealButtons,
};