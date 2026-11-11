/** Path tabs: switcher for mutually exclusive routes through one guide step. Markup is in the guide. */

function getTabs(group: HTMLElement): HTMLElement[] {
    return Array.from(
        group.querySelectorAll<HTMLElement>(":scope > .path-tabs__bar > .path-tabs__tab"),
    );
}

function getPanels(group: HTMLElement): HTMLElement[] {
    return Array.from(
        group.querySelectorAll<HTMLElement>(":scope > .path-tabs__panels > .path-tabs__panel"),
    );
}

function activatePath(group: HTMLElement, index: number): void {
    const tabs = getTabs(group);
    const panels = getPanels(group);
    if (index < 0 || index >= panels.length) return;

    tabs.forEach((tab, i) => {
        const isActive = i === index;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel, i) => {
        panel.hidden = i !== index;
    });
}

/** Opens every (nested) path containing `id`. Returns whether it was hidden. */
function revealPathTo(id: string): boolean {
    if (!id) return false;

    let target: HTMLElement | null = null;
    try {
        target = document.getElementById(decodeURIComponent(id));
    } catch {
        target = document.getElementById(id);
    }
    if (!target) return false;

    const wasHidden = target.closest(".path-tabs__panel[hidden]") !== null;
    let panel = target.closest<HTMLElement>(".path-tabs__panel");
    while (panel) {
        const group = panel.parentElement?.closest<HTMLElement>(".path-tabs");
        if (!group) break;
        activatePath(group, getPanels(group).indexOf(panel));
        panel = group.parentElement?.closest<HTMLElement>(".path-tabs__panel") ?? null;
    }
    return wasHidden;
}

function revealPathToHash(hash: string): boolean {
    return hash.length > 1 && revealPathTo(hash.slice(1));
}

/** Sets the offset that lands a deep link on the tab bar rather than below it. */
function measureBar(group: Element): void {
    const panels = group.querySelector(":scope > .path-tabs__panels");
    if (!(group instanceof HTMLElement) || !panels) return;
    const height = panels.getBoundingClientRect().top - group.getBoundingClientRect().top;
    group.style.setProperty("--path-tabs-bar-height", `${Math.round(height)}px`);
}

function initPathTabs(): void {
    const groups = document.querySelectorAll<HTMLElement>(".path-tabs");
    if (!groups.length) return;

    const barObserver = new ResizeObserver((entries) => {
        for (const { target } of entries) {
            if (target.parentElement) measureBar(target.parentElement);
        }
    });

    for (const group of groups) {
        // Measured now as well as on resize: the observer reports after the next
        // layout, which can be too late for a deep link's jump.
        measureBar(group);
        const bar = group.querySelector(":scope > .path-tabs__bar");
        if (bar) barObserver.observe(bar);

        const tabs = getTabs(group);

        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => activatePath(group, index));

            tab.addEventListener("keydown", (event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = (index + step + tabs.length) % tabs.length;
                activatePath(group, next);
                tabs[next].focus();
            });
        });
    }

    // Capture phase, to open the path before the link's default jump.
    document.addEventListener(
        "click",
        (event) => {
            const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href*="#"]');
            if (!link) return;
            const href = link.getAttribute("href") ?? "";
            const hashIndex = href.indexOf("#");
            if (hashIndex < 0) return;
            if (hashIndex > 0 && link.pathname !== window.location.pathname) return;
            revealPathToHash(href.slice(hashIndex));
        },
        true,
    );

    // The browser jumps before hashchange fires, and it can't jump to a closed panel.
    window.addEventListener("hashchange", () => {
        if (!revealPathToHash(window.location.hash)) return;
        document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
    });
    revealPathToHash(window.location.hash);
}

// Runs first of the core scripts: a deep link into a collapsed path has to open
// that path before the browser scrolls the target into view.
document.addEventListener("DOMContentLoaded", initPathTabs);
