/**
 * In-page navigation. The browser does the scrolling: fragment jumps land clear of
 * the top bar through scroll-padding-top (reset.css), and it restores the reader's
 * position on Back, Forward and reload.
 */

/** A new history entry, so Back returns the reader to their spot. */
function scrollToTop(): void {
    window.history.pushState(null, "", "#");
    window.scrollTo({ top: 0 });
}

// Tells the return pill (ui/return-pill.ts) when a reader follows an in-page link.
document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.tagName !== "A") return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;

    const href = target.getAttribute("href");
    if (!href || !href.startsWith("#") || !document.getElementById(href.substring(1))) return;

    // The pill decides whether the link qualifies.
    document.dispatchEvent(
        new CustomEvent("scrollmanager:navigate", { detail: { anchor: target } }),
    );
});

function initBackToTop(): void {
    const buttons = document.querySelectorAll(".btn--fixed.bottom-right");
    buttons.forEach((button) => button.addEventListener("click", scrollToTop));

    const phone = window.matchMedia("(width < 48.0625em)"); // --bp-md
    let lastTop = window.scrollY;
    let scrollingUp = false;

    const update = (): void => {
        const top = window.scrollY;
        // Ignores the small jitter a touch scroll makes when it settles.
        if (Math.abs(top - lastTop) > 8) {
            scrollingUp = top < lastTop;
            lastTop = top;
        }

        // A phone has no margin, so the button would cover the text; show it only when scrolling up.
        buttons.forEach((button) => {
            const wanted = scrollingUp || !phone.matches;
            button.classList.toggle("is-visible", top > 200 && wanted);
        });
    };

    // Restoring position on reload or Back fires a scroll event too.
    window.addEventListener("scroll", update, { passive: true });
    update();
}

initBackToTop();
