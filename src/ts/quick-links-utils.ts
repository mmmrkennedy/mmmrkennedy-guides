/**
 * Shared utilities for quick links generation (browser runtime fallback).
 *
 * The build-time table of contents is produced independently in
 * eleventy.config.cjs; these helpers only run when a page ships without a
 * pre-built TOC.
 */

/** Returns true if the element (or any ancestor) opts out of quick links. */
function shouldExcludeElement(element: HTMLElement): boolean {
    let current: Element | null = element;
    while (current) {
        if (
            current.classList.contains("solver-container") ||
            current.classList.contains("stats") ||
            current.classList.contains("weapon-desc") ||
            current.classList.contains("warning") ||
            current.classList.contains("solver-output") ||
            current.classList.contains("solver-symbol-select") ||
            current.classList.contains("aligned-buttons") ||
            current.classList.contains("aligned-label")
        ) {
            return true;
        }
        current = current.parentElement;
    }

    return element.dataset.boolQuickLink === "false";
}

/** Gets the title text from an element. */
function getElementTitle(element: HTMLElement): string {
    // If there's a custom title specified, use that
    if (element.dataset.customTitle) {
        return element.dataset.customTitle;
    }

    if (element.children.length !== 0) {
        const first = element.children[0];
        return first.textContent || (first as HTMLElement).innerText || "";
    }

    return element.textContent ?? "";
}

/** Gets all elements that should be included in quick links. */
function getQuickLinkElements(doc: Document): QuickLinkItem[] {
    const results: QuickLinkItem[] = [];

    const containers = doc.querySelectorAll<HTMLElement>("div.content-container");

    for (const container of containers) {
        if (shouldExcludeElement(container)) continue;

        results.push({
            element: container,
            indentLevel: 0,
            isSectionHeader: container.dataset.sectionInd !== undefined,
            sectionHeaderLevel:
                container.dataset.sectionHeaderLevel !== undefined ? container.dataset.sectionHeaderLevel : 0,
        });

        const titles = container.querySelectorAll<HTMLElement>("p.title-tier-2, p.title-tier-3, p.title-tier-4");

        for (const [titleCounter, title] of titles.entries()) {
            if (shouldExcludeElement(title)) continue;

            let indentLevel = 1;
            // tier-4 looks like tier-3 but nests one level deeper in the Contents list.
            if (title.classList.contains("title-tier-4") && titleCounter !== 0) {
                indentLevel = 2;
            }
            if (title.dataset.customIndent) {
                indentLevel = Number(title.dataset.customIndent);
            }

            if (title.dataset.customQuickLink) {
                const customLinks = title.dataset.customQuickLink.split(";");
                title.id = customLinks[0];
                for (const customName of customLinks) {
                    results.push({
                        element: title,
                        indentLevel,
                        custom_name: customName,
                    });
                }
            } else {
                results.push({
                    element: title,
                    indentLevel,
                });
            }
        }
    }

    return results;
}

// Make available globally for browser environments
window.QuickLinksUtils = {
    getElementTitle,
    getQuickLinkElements,
};
