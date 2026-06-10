/**
 * Return pill
 * -----------
 * After the reader follows an in-page cross-reference (a teal `.link-to-page`
 * link inside the guide body — e.g. "DRI-11 Beamsmasher" in a Main Quest step),
 * a small dismissible pill slides up: "← Back to «section»". Clicking it returns
 * them to the exact spot they jumped from.
 *
 * It does no scrolling of its own — it piggybacks on the history-based scroll
 * restoration in navigation/scroll-manager.ts (which stamps the leaving scroll
 * position into history). "Go back" is just history.back(); the popstate handler
 * there restores the position. We listen for the "scrollmanager:navigate" event
 * that scroll-manager dispatches on qualifying in-page link clicks.
 *
 * The pill self-dismisses when it's no longer useful: the reader returns, clicks
 * ×, presses Escape, navigates with the browser buttons, or scrolls the origin
 * section back into view.
 */
document.addEventListener("DOMContentLoaded", () => {
    const contentWindow = document.querySelector<HTMLElement>(".content-window");
    if (!contentWindow) return;

    let pill: HTMLButtonElement | null = null;
    let labelEl: HTMLElement | null = null;
    let armed = false; // a jump is active and the pill is offering a return
    let originSection: HTMLElement | null = null;
    let leftOrigin = false; // origin has scrolled out of view at least once

    // Hide the pill once the reader scrolls the section they left back into view
    // (but only after it first left — a short jump can leave the origin on screen).
    const io =
        "IntersectionObserver" in window
            ? new IntersectionObserver(
                (entries) => {
                    for (const en of entries) {
                        if (en.target !== originSection) continue;
                        if (!en.isIntersecting) leftOrigin = true;
                        else if (leftOrigin && armed) hide();
                    }
                },
                { root: contentWindow },
            )
            : null;

    function ensurePill(): HTMLButtonElement {
        if (pill) return pill;
        const el = document.createElement("button");
        el.type = "button";
        el.className = "return-pill";
        el.innerHTML =
            '<svg class="return-pill__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>' +
            '<span class="return-pill__text"></span>' +
            '<span class="return-pill__dismiss" aria-hidden="true">×</span>';
        el.addEventListener("click", (e) => {
            if ((e.target as HTMLElement).closest(".return-pill__dismiss")) {
                hide();
                return;
            }
            goBack();
        });
        document.body.appendChild(el);
        pill = el;
        labelEl = el.querySelector(".return-pill__text");
        return el;
    }

    function show(fromLabel: string, section: HTMLElement | null): void {
        const el = ensurePill();
        if (labelEl) {
            labelEl.textContent = fromLabel ? `Back to ${fromLabel}` : "Back to where you were";
        }
        el.setAttribute("aria-label", labelEl?.textContent ?? "Back");

        // Re-target the origin watcher.
        if (io && originSection) io.unobserve(originSection);
        originSection = section;
        leftOrigin = false;
        if (io && originSection) io.observe(originSection);

        armed = true;
        // Defer the class flip so the transition runs even on a freshly created node.
        requestAnimationFrame(() => el.classList.add("is-visible"));
    }

    function hide(): void {
        armed = false;
        leftOrigin = false;
        if (io && originSection) io.unobserve(originSection);
        originSection = null;
        pill?.classList.remove("is-visible");
    }

    function goBack(): void {
        // Disarm before stepping back so our own popstate listener doesn't fight
        // scroll-manager's restoration.
        hide();
        window.history.back();
    }

    /** Nearest section the clicked link sits in — the place being left. */
    function sectionFor(anchor: HTMLElement): HTMLElement | null {
        return anchor.closest<HTMLElement>(".content-container");
    }

    function labelFor(section: HTMLElement | null): string {
        const title = section?.querySelector<HTMLElement>(".title-tier-1, h2, h3, h4");
        return (title?.textContent ?? "").trim();
    }

    document.addEventListener("scrollmanager:navigate", (e) => {
        const anchor = (e as CustomEvent<{ anchor?: HTMLElement }>).detail?.anchor;
        // Only inline content cross-references qualify — not the TOC / quick-links,
        // which never carry the .link-to-page class.
        if (!anchor || !anchor.classList.contains("link-to-page")) return;
        const section = sectionFor(anchor);
        show(labelFor(section), section);
    });

    // The reader navigated with the browser buttons — the offer is consumed.
    window.addEventListener("popstate", () => {
        if (armed) hide();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && armed) hide();
    });
});
