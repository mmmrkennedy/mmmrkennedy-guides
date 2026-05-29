/**
 * Scroll management and history handling
 * Manages smooth scrolling, anchor navigation, and browser history
 */

/** Scrolls to the top of the content window. */
function scrollToTop(fromPopstate = false): void {
    const contentWindow = document.querySelector(".content-window");
    if (!contentWindow) return;

    contentWindow.scrollTo({ top: 0, behavior: "smooth" });

    // Only add to history if this wasn't triggered by popstate
    if (!fromPopstate) {
        window.history.pushState({ anchor: null }, "", "#");
    }
}

/** Sets up a delegated click listener for in-page anchor links. */
function scrollToAnchors(): void {
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.tagName !== "A") return;

        const href = target.getAttribute("href");
        if (href && href.startsWith("#")) {
            event.preventDefault();
            scrollToElement(href.substring(1)); // This will add to history
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

    const elementPosition = element.getBoundingClientRect().top;
    const targetY = elementPosition + contentWindow.scrollTop - cachedTopBarHeight;

    contentWindow.scrollTo({ top: targetY, behavior: "smooth" });

    // Only add to history if this wasn't triggered by popstate (back/forward button)
    if (!fromPopstate) {
        window.history.pushState({ anchor: elementId }, "", "#" + elementId);
    }
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
    window.addEventListener("popstate", () => {
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            scrollToElement(hash.substring(1), true);
            return;
        }

        const contentWindow = document.querySelector(".content-window");
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
