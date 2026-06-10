/**
 * Scroll management and history handling
 * Manages smooth scrolling, anchor navigation, and browser history
 */

/** Scrolls to the top of the content window. */
function scrollToTop(fromPopstate = false): void {
    const contentWindow = document.querySelector(".content-window");
    if (!contentWindow) return;

    // Stamp where we are onto the current entry before leaving, then push the
    // "top" entry — so Back returns the reader to their spot, not the top.
    if (!fromPopstate) {
        const current = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.replaceState({ ...current, scrollTop: contentWindow.scrollTop }, "");
        window.history.pushState({ anchor: null, scrollTop: 0 }, "", "#");
    }

    contentWindow.scrollTo({ top: 0, behavior: "smooth" });
}

/** Sets up a delegated click listener for in-page anchor links. */
function scrollToAnchors(): void {
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.tagName !== "A") return;

        const href = target.getAttribute("href");
        if (href && href.startsWith("#")) {
            event.preventDefault();
            const id = href.substring(1);
            scrollToElement(id); // This will add to history

            // Tell the return-pill (ui/return-pill.ts) a real in-page jump just
            // happened, so it can offer a "← Back to <section>" affordance. Only
            // fires when the target exists; the pill itself decides whether the
            // link qualifies (content cross-refs carry the .link-to-page class).
            if (document.getElementById(id)) {
                document.dispatchEvent(
                    new CustomEvent("scrollmanager:navigate", { detail: { anchor: target } }),
                );
            }
        }
    });
}

// Measured once on first use; the top bar height doesn't change at runtime.
let cachedTopBarHeight: number | null = null;

/** Scrolls to a specific element by ID, offset by the fixed top bar. */
function scrollToElement(elementId: string, fromPopstate = false): void {
    const element = document.getElementById(elementId);
    const contentWindow = document.querySelector(".content-window");

    if (cachedTopBarHeight === null) {
        const topBackgroundBox = document.querySelector(".top-buttons-background-box");
        cachedTopBarHeight = topBackgroundBox ? topBackgroundBox.getBoundingClientRect().height : 0;
    }

    if (!element || !contentWindow) return;

    const currentScroll = contentWindow.scrollTop;
    const elementPosition = element.getBoundingClientRect().top;
    const targetY = elementPosition + currentScroll - cachedTopBarHeight;

    // Record positions in history BEFORE scrolling, so Back/Forward return the
    // reader exactly where they were (restored in the popstate handler below)
    // instead of jumping to the top. We stamp the reading spot we're leaving
    // onto the current entry, then push a new entry for the jump target.
    if (!fromPopstate) {
        const current = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.replaceState({ ...current, scrollTop: currentScroll }, "");
        window.history.pushState({ anchor: elementId, scrollTop: targetY }, "", "#" + elementId);
    }

    contentWindow.scrollTo({ top: targetY, behavior: "smooth" });
}

/** Clears the hash from the URL and scrolls to top. */
function clearHashAndScrollTop(): void {
    if (window.location.hash) {
        window.history.replaceState(null, "", window.location.href.split("#")[0]);
    }

    const contentWindow = document.querySelector(".content-window");
    if (contentWindow) {
        contentWindow.scrollTo({ top: 0, behavior: "auto" });
    }
}

/** Wires the popstate handler for browser back/forward buttons. */
function initHistoryManagement(): void {
    // We drive the content-window's scroll ourselves (it's a scrollable <div>,
    // not the document), so the browser's own scroll restoration can't help and
    // would only fight us — turn it off.
    if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
    }

    window.addEventListener("popstate", (event) => {
        const contentWindow = document.querySelector(".content-window");
        const state = event.state as { scrollTop?: number; anchor?: string } | null;

        // Preferred path: an entry we stamped with a scroll position — restore
        // that exact spot. This is the "back to where I was" behaviour.
        if (contentWindow && state && typeof state.scrollTop === "number") {
            contentWindow.scrollTo({ top: state.scrollTop, behavior: "smooth" });
            return;
        }

        // Fallbacks for entries created before this feature / external deep links.
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            scrollToElement(hash.substring(1), true);
            return;
        }

        if (contentWindow && contentWindow.scrollTop > 0) {
            scrollToTop(true);
        } else {
            window.history.back();
        }
    });
}

// Make functions available globally
window.ScrollManager = {
    scrollToTop,
    scrollToAnchors,
    scrollToElement,
    clearHashAndScrollTop,
    initHistoryManagement,
};
