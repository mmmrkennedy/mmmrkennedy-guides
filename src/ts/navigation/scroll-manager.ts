/**
 * In-page navigation. The browser does the scrolling: fragment jumps land clear of
 * the top bar through scroll-padding-top (reset.css), and it restores the reader's
 * position on Back, Forward and reload.
 */

/** Scrolls to the top as a new history entry, so Back returns the reader to their spot. */
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

    // The pill decides whether the link qualifies (content cross-refs carry the
    // .link-to-page class).
    document.dispatchEvent(
        new CustomEvent("scrollmanager:navigate", { detail: { anchor: target } }),
    );
});

/** Wires up Back to Top, which shows only once the reader has scrolled away from the top. */
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

        // A phone has no margin to park the button in, so it would sit on the text
        // being read. It only shows there once the reader starts heading back up.
        buttons.forEach((button) => {
            const wanted = scrollingUp || !phone.matches;
            button.classList.toggle("is-visible", top > 200 && wanted);
        });
    };

    // Also covers the restored position on a reload or Back, since restoring it
    // fires a scroll event of its own.
    window.addEventListener("scroll", update, { passive: true });
    update();
}

initBackToTop();
