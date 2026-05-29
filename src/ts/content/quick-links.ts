/**
 * Quick links generation and management
 * Handles the creation and rendering of navigation quick links
 */

/**
 * Initializes quick links generation for the current page.
 * The TOC is normally pre-built at build time; this only generates one as a
 * runtime fallback when the container ships empty.
 */
function initializeQuickLinks(): void {
    try {
        const page = window.PageUtils.getCurrentPage();
        if (!page || page === "index.html") return;

        const parentElement = document.querySelector<HTMLElement>(".quick-links-container");
        if (!parentElement) {
            console.warn("Quick Links container (quick-links-container) not found");
            return;
        }

        // Exit early if navigation already exists (built at build-time)
        if (parentElement.children.length > 0) return;

        // Fallback: generate navigation dynamically only if empty
        console.warn("Navigation not pre-built, generating at runtime (fallback)");
        const elementsData = window.QuickLinksUtils.getQuickLinkElements(document);
        generateQuickLinks(parentElement, elementsData);
    } catch (e) {
        console.error("Error initializing quick links:", e);
    }
}

/**
 * Generates quick links DOM elements from element data.
 * Creates a nested navigation structure with proper indentation.
 */
function generateQuickLinks(parentElement: HTMLElement, elements: QuickLinkItem[]): void {
    if (!elements || elements.length === 0) return;

    let currentList: HTMLUListElement | null = null;
    let listStack: HTMLUListElement[] = [];
    let currentIndentLevel = 0;

    const fragment = document.createDocumentFragment();

    for (const item of elements) {
        const { element, indentLevel, isSectionHeader, sectionHeaderLevel } = item;

        if (!element || indentLevel === undefined) continue;
        if (element.style.display === "none") continue;

        if (isSectionHeader) {
            if (sectionHeaderLevel === 0) {
                const sectionHeader = document.createElement("h2");
                sectionHeader.innerText = element.dataset.sectionInd ?? "";
                fragment.appendChild(sectionHeader);
            } else {
                const sectionHeader = document.createElement("h4");
                sectionHeader.classList.add("sub-header");
                sectionHeader.innerText = element.dataset.sectionInd ?? "";
                fragment.appendChild(sectionHeader);
            }

            currentList = document.createElement("ul");
            fragment.appendChild(currentList);
            listStack = [currentList];
            currentIndentLevel = 0;
        }

        if (!currentList) {
            currentList = document.createElement("ul");
            fragment.appendChild(currentList);
            listStack = [currentList];
            currentIndentLevel = 0;
        }

        const elementId = element.id;
        if (elementId === "") continue; // Skip if no valid ID

        const listItem = document.createElement("li");
        const link = document.createElement("a");
        link.href = `#${elementId}`;
        link.innerText = item.custom_name || window.QuickLinksUtils.getElementTitle(element);
        listItem.appendChild(link);

        // Handle nesting
        if (indentLevel > currentIndentLevel) {
            while (currentIndentLevel < indentLevel) {
                const newList = document.createElement("ul");
                const top = listStack[listStack.length - 1];

                if (top.lastElementChild) {
                    top.lastElementChild.appendChild(newList);
                } else {
                    // If there's no last element, create a dummy item
                    const dummyItem = document.createElement("li");
                    dummyItem.textContent = "Untitled";
                    top.appendChild(dummyItem);
                    dummyItem.appendChild(newList);
                }

                listStack.push(newList);
                currentIndentLevel++;
            }
        } else if (indentLevel < currentIndentLevel) {
            while (listStack.length > 1 && currentIndentLevel > indentLevel) {
                listStack.pop();
                currentIndentLevel--;
            }
        }

        if (listStack.length > 0) {
            listStack[listStack.length - 1].appendChild(listItem);
        }
    }

    parentElement.appendChild(fragment);
}

/**
 * Creates a fixed sidebar TOC by cloning the top ToC container.
 * Only visible at wide viewports via CSS.
 */
function initializeSidebarToc(): void {
    if (document.body.dataset.skipToc === "true") return;

    const tocContainer = document.querySelector<HTMLElement>(".quick-links-container");
    if (!tocContainer || !tocContainer.children.length) return;

    document.querySelector(".sidebar-toc")?.remove();

    const sidebar = document.createElement("nav");
    sidebar.className = "sidebar-toc";
    sidebar.setAttribute("aria-label", "Page contents");

    const header = document.createElement("div");
    header.className = "sidebar-toc-header";

    const label = document.createElement("p");
    label.className = "sidebar-toc-label";
    label.textContent = "Contents";
    header.appendChild(label);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sidebar-toc-toggle";
    toggle.setAttribute("aria-label", "Toggle table of contents");
    toggle.textContent = "Hide";
    header.appendChild(toggle);

    sidebar.appendChild(header);

    const tocBody = document.createElement("div");
    tocBody.className = "sidebar-toc-body";
    for (const child of tocContainer.children) {
        tocBody.appendChild(child.cloneNode(true));
    }
    sidebar.appendChild(tocBody);

    toggle.addEventListener("click", () => {
        const collapsed = tocBody.style.display === "none";
        tocBody.style.display = collapsed ? "" : "none";
        toggle.textContent = collapsed ? "Hide" : "Show";
    });

    setupSidebarSubToggles(tocBody);

    document.body.appendChild(sidebar);
    positionSidebarToc(sidebar);
}

/**
 * Positions the sidebar using actual DOM measurements so it always
 * sits flush to the left of the content, regardless of scrollbar width.
 */
function positionSidebarToc(sidebar: HTMLElement): void {
    const contentWindow = document.querySelector<HTMLElement>(".content-window");
    const footer = document.querySelector<HTMLElement>(".content-window .site-footer");
    const bottomGap = 24; // matches --space-lg

    // Horizontal: keep the sidebar flush to the left of the content column.
    function updateHorizontal(): void {
        const firstContainer = document.querySelector<HTMLElement>(".content-window .content-container");
        if (!firstContainer) return;

        const rect = firstContainer.getBoundingClientRect();
        const gap = 10;
        const minLeft = 8;
        const maxWidth = 340;

        const rightEdge = rect.left - gap;
        const width = Math.min(rightEdge - minLeft, maxWidth);

        if (width < 80) return;

        sidebar.style.right = `${window.innerWidth - rightEdge}px`;
        sidebar.style.width = `${width}px`;
    }

    // Vertical: clamp the bottom so a long TOC never overlaps the footer once
    // the page scrolls to the end. Shrinking max-height lets it scroll internally.
    function updateHeight(): void {
        const navTop = sidebar.getBoundingClientRect().top;
        let bottomLimit = window.innerHeight - bottomGap;

        if (footer) {
            const footerTop = footer.getBoundingClientRect().top;
            bottomLimit = Math.min(bottomLimit, footerTop - bottomGap);
        }

        sidebar.style.maxHeight = `${Math.max(0, bottomLimit - navTop)}px`;
    }

    updateHorizontal();
    updateHeight();

    // The footer lives inside .content-window, so its viewport position changes
    // as that container scrolls — re-clamp on scroll (rAF-throttled).
    let scrollFrame: number | null = null;
    contentWindow?.addEventListener("scroll", () => {
        if (scrollFrame !== null) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            updateHeight();
        });
    }, { passive: true });

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            updateHorizontal();
            updateHeight();
        }, 100);
    });
}

/**
 * Adds collapse toggles to each li that contains a nested ul in the sidebar TOC.
 */
function setupSidebarSubToggles(container: HTMLElement): void {
    const lisWithChildren = container.querySelectorAll<HTMLLIElement>("li:has(> ul)");

    for (const li of lisWithChildren) {
        const childUl = li.querySelector<HTMLUListElement>(":scope > ul");
        if (!childUl) continue;

        childUl.style.display = "none";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar-toc-sub-toggle";
        btn.setAttribute("aria-label", "Toggle sub-items");
        btn.textContent = "▸";

        li.insertBefore(btn, li.firstChild);

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const collapsed = childUl.style.display === "none";
            childUl.style.display = collapsed ? "" : "none";
            btn.textContent = collapsed ? "▾" : "▸";
        });
    }
}

// Make functions available globally
window.QuickLinks = {
    initializeQuickLinks,
    generateQuickLinks,
    initializeSidebarToc,
};
