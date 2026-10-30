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
            window.Log("warn", "Quick Links container (quick-links-container) not found");
            return;
        }

        parentElement.addEventListener("click", toggleContentsSubList);

        // Exit early if navigation already exists (built at build-time)
        if (parentElement.children.length > 0) return;

        // Fallback: generate navigation dynamically only if empty
        window.Log("warn", "Navigation not pre-built, generating at runtime (fallback)");
        const elementsData = window.QuickLinksUtils.getQuickLinkElements(document);
        generateQuickLinks(parentElement, elementsData);
    } catch (e) {
        window.Log("error", "Error initializing quick links:", e);
    }
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
 * Wires up the fixed sidebar TOC. Only visible at wide viewports via CSS.
 *
 * The markup is normally pre-rendered by the generateQuickLinks transform, so
 * it paints with the rest of the page; here we only attach behaviour to it.
 * Building it at runtime is the fallback for pages that shipped without it.
 */
function initializeSidebarToc(): void {
    if (document.body.dataset.skipToc === "true") return;

    const prebuilt = document.querySelector<HTMLElement>(".sidebar-toc[data-prebuilt='true']");
    if (prebuilt) {
        bindSidebarToggles(prebuilt);
        positionSidebarToc(prebuilt);
        trackCurrentSection(prebuilt);
        return;
    }

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

    setupSidebarSubToggles(tocBody);

    document.body.appendChild(sidebar);
    bindSidebarToggles(sidebar);
    positionSidebarToc(sidebar);
    trackCurrentSection(sidebar);
}

/**
 * Marks the sidebar link for the section being read, opening its collapsed
 * parents and keeping it in view. Parents opened this way close again once the
 * reader moves on; ones the reader opened or closed by hand are left alone.
 */
function trackCurrentSection(sidebar: HTMLElement): void {
    const contentWindow = document.querySelector<HTMLElement>(".content-window");
    if (!contentWindow) return;

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
        const viewTop = contentWindow!.getBoundingClientRect().top;
        const viewHeight = contentWindow!.clientHeight;
        const remaining = contentWindow!.scrollHeight - contentWindow!.scrollTop - viewHeight;
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
    contentWindow.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
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
 * Only used on the runtime fallback path — the build emits these buttons itself.
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
    }
}

/**
 * Attaches the show/hide behaviour to a sidebar's toggle buttons.
 * Works the same whether the markup was pre-rendered or built above.
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

// Make functions available globally
window.QuickLinks = {
    initializeQuickLinks,
    generateQuickLinks,
    initializeSidebarToc,
};
