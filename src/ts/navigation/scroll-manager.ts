/**
 * Scroll management and history handling
 * Manages smooth scrolling, anchor navigation, and browser history
 */

/** See scrollToElement — how a scroll should affect session history. */
type ScrollHistoryMode = "push" | "replace" | "none";

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

/**
 * Some targets need a wider frame than themselves to make sense on arrival.
 * A path panel is only reachable through its tab bar, so scrolling to the panel
 * alone would push the tabs off-screen and hide the fact that the reader can
 * switch routes at all. `data-scroll-with` names an ancestor selector to bring
 * into view instead; the hash still points at the original element.
 */
function resolveScrollTarget(element: HTMLElement): HTMLElement {
    const selector = element.dataset.scrollWith;
    return (selector && element.closest<HTMLElement>(selector)) || element;
}

/**
 * Scrolls to a specific element by ID, offset by the fixed top bar.
 *
 * `historyMode` decides what this does to session history:
 *   "push"    — a jump the reader just initiated; Back should undo it.
 *   "replace" — the entry already exists (a cold load already at this hash), so
 *               stamp our scroll bookkeeping onto it. Pushing here would leave a
 *               duplicate entry that swallows the reader's first Back press.
 *   "none"    — the browser is mid-navigation (popstate/hashchange) and owns
 *               history; touching it would fight the navigation in progress.
 */
function scrollToElement(elementId: string, historyMode: ScrollHistoryMode = "push"): void {
    const element = document.getElementById(elementId);
    const contentWindow = document.querySelector(".content-window");

    if (cachedTopBarHeight === null) {
        const topBackgroundBox = document.querySelector(".top-buttons-background-box");
        cachedTopBarHeight = topBackgroundBox ? topBackgroundBox.getBoundingClientRect().height : 0;
    }

    if (!element || !contentWindow) return;

    const currentScroll = contentWindow.scrollTop;
    const elementPosition = resolveScrollTarget(element).getBoundingClientRect().top;
    const targetY = elementPosition + currentScroll - cachedTopBarHeight;

    // Record positions in history BEFORE scrolling, so Back/Forward return the
    // reader exactly where they were (restored in the popstate handler below)
    // instead of jumping to the top. We stamp the reading spot we're leaving
    // onto the current entry, then push a new entry for the jump target.
    if (historyMode === "push") {
        const current = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.replaceState({ ...current, scrollTop: currentScroll }, "");
        window.history.pushState({ anchor: elementId, scrollTop: targetY }, "", "#" + elementId);
    } else if (historyMode === "replace") {
        window.history.replaceState({ anchor: elementId, scrollTop: targetY }, "", "#" + elementId);
    }

    contentWindow.scrollTo({ top: targetY, behavior: "smooth" });
}

/** Restores a scroll position previously stamped into a history entry. */
function restoreStampedScroll(behavior: ScrollBehavior = "auto"): boolean {
    const state = window.history.state as { scrollTop?: number } | null;
    const contentWindow = document.querySelector(".content-window");
    if (!contentWindow || !state || typeof state.scrollTop !== "number") return false;
    contentWindow.scrollTo({ top: state.scrollTop, behavior });
    return true;
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

    // A hash-only history traversal fires popstate first, then hashchange. By
    // then popstate has already restored the reader's stamped position, so the
    // hashchange handler below must stand down — re-scrolling to the fragment
    // would send them to wherever that anchor sits, not to where they had
    // scrolled to before they left that entry.
    let ignoreNextHashChange = false;

    // Same-document hash changes — editing the fragment in the URL bar, or any
    // link we didn't intercept. The browser's native fragment scroll ignores the
    // fixed header and data-scroll-with, so redo it ourselves. In-page anchor
    // clicks don't reach here: scrollToAnchors preventDefaults them, and the
    // pushState it uses doesn't fire hashchange.
    window.addEventListener("hashchange", () => {
        if (ignoreNextHashChange) {
            ignoreNextHashChange = false;
            return;
        }
        const hash = window.location.hash;
        if (hash.length > 1) scrollToElement(hash.substring(1), "none");
    });

    // Stamp the reading position onto the current entry whenever the page is
    // being left — following a link to another guide, a reload, a tab close.
    // scrollToElement/scrollToTop only stamp on jumps they perform themselves,
    // so before this a plain link exit lost the reader's spot entirely.
    window.addEventListener("pagehide", () => {
        const contentWindow = document.querySelector(".content-window");
        if (!contentWindow) return;
        const current = (window.history.state ?? {}) as Record<string, unknown>;
        window.history.replaceState({ ...current, scrollTop: contentWindow.scrollTop }, "");
    });

    // Coming back to a bfcached document: no DOMContentLoaded fires, so the
    // cold-load restore in scripts.ts never runs. Reapply the stamp here.
    window.addEventListener("pageshow", (event) => {
        if ((event as PageTransitionEvent).persisted) restoreStampedScroll();
    });

    window.addEventListener("popstate", (event) => {
        const contentWindow = document.querySelector(".content-window");
        const state = event.state as { scrollTop?: number; anchor?: string } | null;

        // Claim the hashchange this traversal is about to fire (see above). The
        // timeout is a safety net: a traversal between entries with the same hash
        // fires no hashchange, and a stale flag would swallow the reader's next
        // genuine URL-bar edit.
        ignoreNextHashChange = true;
        window.setTimeout(() => {
            ignoreNextHashChange = false;
        }, 100);

        // Preferred path: an entry we stamped with a scroll position — restore
        // that exact spot. This is the "back to where I was" behaviour.
        if (contentWindow && state && typeof state.scrollTop === "number") {
            contentWindow.scrollTo({ top: state.scrollTop, behavior: "smooth" });
            return;
        }

        // Fallbacks for entries created before this feature / external deep links.
        const hash = window.location.hash;
        if (hash && hash.length > 1) {
            scrollToElement(hash.substring(1), "none");
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
    restoreStampedScroll,
    clearHashAndScrollTop,
    initHistoryManagement,
};
