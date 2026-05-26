/**
 * Legend panel
 * Always-available reference for link colour coding and viewer controls.
 * Can be reopened anytime via the floating "?" launcher in the bottom-left
 * corner.
 */

/**
 * Wires up the legend launcher and overlay (open/close, ESC, click-outside,
 * focus return, and a minimal focus trap).
 */
function initLegend() {
    const launcher = document.getElementById("legendLauncher");
    const overlay = document.getElementById("legendOverlay");
    const closeBtn = document.getElementById("legendClose");
    if (!launcher || !overlay) return;

    function trapFocus(e) {
        const focusables = overlay.querySelectorAll(
            'button, [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    function onKeydown(e) {
        if (e.key === "Escape") {
            closeLegend();
        } else if (e.key === "Tab") {
            trapFocus(e);
        }
    }

    function openLegend() {
        overlay.classList.add("is-open");
        launcher.setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", onKeydown);
        if (closeBtn) closeBtn.focus();
    }

    function closeLegend() {
        overlay.classList.remove("is-open");
        launcher.setAttribute("aria-expanded", "false");
        document.removeEventListener("keydown", onKeydown);
        launcher.focus();
    }

    launcher.addEventListener("click", openLegend);
    if (closeBtn) closeBtn.addEventListener("click", closeLegend);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeLegend();
    });
}

// Make functions available globally
window.Legend = {
    initLegend,
};
