/**
 * Behaviour for the contents lists. The build renders both of them (the
 * generateQuickLinks transform in eleventy.config.cjs).
 */

/** Wires up the phone contents list. */
function initializeQuickLinks(): void {
    document.querySelector(".quick-links-container")?.addEventListener("click", toggleContentsSubList);
}

/**
 * Opens or closes a section of the phone contents list.
 */
function toggleContentsSubList(event: Event): void {
    const btn = (event.target as Element).closest(".quick-links-sub-toggle");
    if (!btn) return;

    const open = btn.parentElement?.classList.toggle("is-open") ?? false;
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "▾" : "▸";
}

/** Wires up the sidebar contents. Only visible at wide viewports via CSS. */
function initializeSidebarToc(): void {
    const sidebar = document.querySelector<HTMLElement>(".sidebar-toc");
    if (!sidebar) return;

    bindSidebarToggles(sidebar);
    trackCurrentSection(sidebar);
}

/**
 * Marks the sidebar link for the section being read, opening its collapsed
 * parents and keeping it in view. Parents opened this way close again once the
 * reader moves on; ones the reader opened or closed by hand are left alone.
 */
function trackCurrentSection(sidebar: HTMLElement): void {
    const topBar = document.querySelector<HTMLElement>(".top-buttons-background-box");

    const targets: { link: HTMLAnchorElement; section: HTMLElement }[] = [];
    for (const link of sidebar.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) {
        const section = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        if (section) targets.push({ link, section });
    }
    if (!targets.length) return;

    const autoOpened = new Set<HTMLElement>();
    let current: HTMLAnchorElement | null = null;

    function setOpen(list: HTMLElement, open: boolean): void {
        list.style.display = open ? "" : "none";
        const toggle = list.parentElement?.querySelector(":scope > .sidebar-toc-sub-toggle");
        if (toggle) toggle.textContent = open ? "▾" : "▸";
    }

    function setCurrent(link: HTMLAnchorElement | null): void {
        if (link === current) return;
        current?.removeAttribute("aria-current");
        link?.setAttribute("aria-current", "location");
        current = link;

        for (const list of autoOpened) {
            if (link && list.contains(link)) continue;
            setOpen(list, false);
            autoOpened.delete(list);
        }
        if (!link) return;

        for (let list = link.closest("ul"); list; list = list.parentElement?.closest("ul") ?? null) {
            if (list.style.display !== "none") continue;
            setOpen(list, true);
            autoOpened.add(list);
        }

        const linkRect = link.getBoundingClientRect();
        const sidebarRect = sidebar.getBoundingClientRect();
        if (linkRect.top < sidebarRect.top || linkRect.bottom > sidebarRect.bottom) {
            sidebar.scrollTop += linkRect.top - sidebarRect.top - sidebar.clientHeight / 2;
        }
    }

    function update(): void {
        if (getComputedStyle(sidebar).display === "none") return;

        // A section counts as current once its heading is near the top of the
        // window. The short sections at the very end can never scroll that far,
        // so over the last screenful the line slides down to the window's bottom.
        const root = document.documentElement;
        const viewTop = topBar ? topBar.getBoundingClientRect().bottom : 0;
        const viewHeight = root.clientHeight - viewTop;
        const remaining = root.scrollHeight - window.scrollY - root.clientHeight;
        const nearTop = 120;
        const slide = Math.max(0, 1 - remaining / viewHeight) * (viewHeight - nearTop);
        const line = viewTop + nearTop + slide;

        let best: HTMLAnchorElement | null = null;
        let bestTop = -Infinity;
        for (const { link, section } of targets) {
            // Hidden path tabs and closed <details> have no boxes to measure.
            if (!section.getClientRects().length) continue;
            const top = section.getBoundingClientRect().top;
            if (top <= line && top >= bestTop) {
                best = link;
                bestTop = top;
            }
        }
        setCurrent(best);
    }

    sidebar.addEventListener("click", (event) => {
        const toggle = (event.target as Element).closest(".sidebar-toc-sub-toggle");
        const list = toggle?.parentElement?.querySelector<HTMLElement>(":scope > ul");
        if (list) autoOpened.delete(list);
    });

    let frame: number | null = null;
    const schedule = (): void => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            update();
        });
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
}

/**
 * Attaches the show/hide behaviour to a sidebar's toggle buttons.
 */
function bindSidebarToggles(sidebar: HTMLElement): void {
    const tocBody = sidebar.querySelector<HTMLElement>(".sidebar-toc-body");
    const toggle = sidebar.querySelector<HTMLButtonElement>(".sidebar-toc-toggle");

    if (tocBody && toggle) {
        toggle.addEventListener("click", () => {
            const collapsed = tocBody.style.display === "none";
            tocBody.style.display = collapsed ? "" : "none";
            toggle.textContent = collapsed ? "Hide" : "Show";
        });
    }

    const subToggles = sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-toc-sub-toggle");

    for (const btn of subToggles) {
        const childUl = btn.parentElement?.querySelector<HTMLUListElement>(":scope > ul");
        if (!childUl) continue;

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const collapsed = childUl.style.display === "none";
            childUl.style.display = collapsed ? "" : "none";
            btn.textContent = collapsed ? "▾" : "▸";
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initializeQuickLinks();
    initializeSidebarToc();
});
