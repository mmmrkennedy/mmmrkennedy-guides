function initRevealButtons(): void {
    document.querySelectorAll<HTMLElement>("[data-reveal-label]").forEach((div) => {
        const button = div.querySelector("button");
        if (!button) return;

        button.addEventListener("click", () => {
            const content = div.querySelector<HTMLElement>(".button-activated-div");
            if (!content) return;
            content.style.display = content.style.display === "none" ? "block" : "none";
        });
    });
}

// Make functions available globally
window.SolverButtonProcessor = {
    initRevealButtons,
};
