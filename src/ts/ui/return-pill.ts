/**
 * "Back to <section>" pill after following a `.link-to-page` cross-reference.
 * Same-page jumps arrive via scroll-manager's "scrollmanager:navigate" event;
 * cross-page links (`.internal-link`) hand the origin over in sessionStorage.
 * Does no scrolling itself: history.back() relies on scroll-manager.ts having
 * stamped the scroll position into history.
 */
document.addEventListener("DOMContentLoaded", () => {
    let pill: HTMLButtonElement | null = null;
    let labelEl: HTMLElement | null = null;
    let armed = false;
    let originSection: HTMLElement | null = null;
    // A short jump can leave the origin on screen, so it must leave view once first.
    let leftOrigin = false;

    // The margin stops a section behind the sticky top bar counting as seen.
    const topBarHeight = document.querySelector(".top-buttons-background-box")?.getBoundingClientRect().height ?? 0;
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
                { rootMargin: `-${Math.round(topBarHeight)}px 0px 0px 0px` },
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
            '<span class="return-pill__dismiss" aria-hidden="true"></span>'; // glyph drawn via ::before so it can be nudged to optical center
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
            if (fromLabel) {
                labelEl.textContent = "Back to ";
                const em = document.createElement("i");
                const strong = document.createElement("strong");
                strong.textContent = fromLabel;
                em.appendChild(strong);
                labelEl.appendChild(em);
            } else {
                labelEl.textContent = "Back to where you were";
            }
        }
        el.setAttribute("aria-label", labelEl?.textContent ?? "Back");

        if (io && originSection) io.unobserve(originSection);
        originSection = section;
        leftOrigin = false;
        if (io && originSection) io.observe(originSection);

        armed = true;
        // Deferred so the transition runs on a freshly created node.
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
        // Disarm first so our popstate listener doesn't fight the restoration.
        hide();
        window.history.back();
    }

    function sectionFor(anchor: HTMLElement): HTMLElement | null {
        return anchor.closest<HTMLElement>(".content-container");
    }

    function labelFor(section: HTMLElement | null): string {
        const title = section?.querySelector<HTMLElement>(".title-tier-1, h2, h3, h4");
        return (title?.textContent ?? "").trim();
    }

    document.addEventListener("scrollmanager:navigate", (e) => {
        const anchor = (e as CustomEvent<{ anchor?: HTMLElement }>).detail?.anchor;
        // TOC and quick-links never carry .link-to-page.
        if (!anchor || !anchor.classList.contains("link-to-page")) return;
        const section = sectionFor(anchor);
        show(labelFor(section), section);
    });

    const HANDOFF_KEY = "guides:return-to";

    interface Handoff {
        /** Absolute URL, hash included. */
        from: string;
        label: string;
    }

    function readHandoff(): Handoff | null {
        let raw: string | null = null;
        try {
            raw = window.sessionStorage.getItem(HANDOFF_KEY);
            // Only ever valid for the one navigation that wrote it.
            window.sessionStorage.removeItem(HANDOFF_KEY);
        } catch {
            return null;
        }
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw) as Handoff;
            return parsed && typeof parsed.from === "string" ? parsed : null;
        } catch {
            return null;
        }
    }

    document.addEventListener("click", (e) => {
        const anchor = (e.target as Element | null)?.closest<HTMLAnchorElement>(
            "a.link-to-page.internal-link",
        );
        if (!anchor) return;

        // Modified clicks open a new tab; this tab isn't leaving.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (anchor.target && anchor.target !== "_self") return;

        // Same document: the scrollmanager:navigate path covers it.
        if (anchor.pathname === window.location.pathname) return;

        try {
            const payload: Handoff = {
                from: window.location.href,
                label: labelFor(sectionFor(anchor)),
            };
            window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
        } catch {
            /* storage unavailable: no pill */
        }
    });

    const handoff = readHandoff();
    // Check the referrer: a new tab can inherit a copy of sessionStorage.
    if (handoff && document.referrer && document.referrer.split("#")[0] === handoff.from.split("#")[0]) {
        show(handoff.label, null);
    }

    window.addEventListener("popstate", () => {
        if (armed) hide();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && armed) hide();
    });
});
