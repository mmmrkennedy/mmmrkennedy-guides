"use strict";
/**
 * Segmented switcher for mutually exclusive routes through one guide step
 * (e.g. the solver route vs. the in-game intended route).
 *
 * The markup is expanded at build time by the `preRenderPathTabs` transform in
 * eleventy.config.cjs — this module only wires the interaction.
 */
/** Tabs belonging to `group` itself, not to any switcher nested inside it. */
function getTabs(group) {
    return Array.from(group.querySelectorAll(":scope > .path-tabs__bar > .path-tabs__tab"));
}
/** Panels belonging to `group` itself, not to any switcher nested inside it. */
function getPanels(group) {
    return Array.from(group.querySelectorAll(":scope > .path-tabs__panels > .path-tabs__panel"));
}
function activatePath(group, index) {
    const tabs = getTabs(group);
    const panels = getPanels(group);
    if (index < 0 || index >= panels.length)
        return;
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
/**
 * Opens whichever path contains `id`, so a cross-reference into a collapsed
 * route lands on the steps instead of on a closed panel. Walks outward so
 * nested switchers all open along the way.
 */
function revealPathTo(id) {
    if (!id)
        return;
    let target = null;
    try {
        target = document.getElementById(decodeURIComponent(id));
    }
    catch {
        target = document.getElementById(id);
    }
    if (!target)
        return;
    let panel = target.closest(".path-tabs__panel");
    while (panel) {
        const group = panel.parentElement?.closest(".path-tabs");
        if (!group)
            break;
        activatePath(group, getPanels(group).indexOf(panel));
        panel = group.parentElement?.closest(".path-tabs__panel") ?? null;
    }
}
function revealPathToHash(hash) {
    if (hash.length > 1)
        revealPathTo(hash.slice(1));
}
function initPathTabs() {
    const groups = document.querySelectorAll(".path-tabs");
    if (!groups.length)
        return;
    for (const group of groups) {
        const tabs = getTabs(group);
        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => activatePath(group, index));
            tab.addEventListener("keydown", (event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step)
                    return;
                event.preventDefault();
                const next = (index + step + tabs.length) % tabs.length;
                activatePath(group, next);
                tabs[next].focus();
            });
        });
    }
    // Open the right path before anything scrolls to it. Capture phase so this
    // runs ahead of ScrollManager's own anchor handling.
    document.addEventListener("click", (event) => {
        const link = event.target?.closest('a[href*="#"]');
        if (!link)
            return;
        const href = link.getAttribute("href") ?? "";
        const hashIndex = href.indexOf("#");
        if (hashIndex < 0)
            return;
        // Ignore links pointing at a different page.
        if (hashIndex > 0 && link.pathname !== window.location.pathname)
            return;
        revealPathToHash(href.slice(hashIndex));
    }, true);
    window.addEventListener("hashchange", () => revealPathToHash(window.location.hash));
    revealPathToHash(window.location.hash);
}
// Make functions available globally
window.PathTabs = {
    initPathTabs,
    revealPathTo,
};
