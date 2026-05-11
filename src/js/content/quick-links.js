/**
 * Quick links generation and management
 * Handles the creation and rendering of navigation quick links
 */

/**
 * Initializes quick links generation for the current page
 * Creates navigation container and generates quick access links
 */
function initializeQuickLinks() {
    try {
        const page = window.PageUtils.getCurrentPage();

        if (!page || page === "index.html") return;

        const parentElement = document.querySelector(".quick-links-container");

        if (!parentElement) {
            console.warn("Quick Links container (quick-links-container) not found");
            return;
        }

        // Exit early if navigation already exists (built at build-time)
        if (parentElement.children.length > 0) {
            // console.log("Quick Links already pre-built, skipping runtime generation");
            return;
        }

        // Fallback: generate navigation dynamically only if empty
        console.warn("Navigation not pre-built, generating at runtime (fallback)");
        const elementsData = window.QuickLinksUtils.getQuickLinkElements(document);
        generateQuickLinks(parentElement, elementsData);
    } catch (e) {
        console.error("Error initializing quick links:", e);
    }
}

/**
 * Generates quick links DOM elements from element data
 * Creates nested navigation structure with proper indentation
 */
function generateQuickLinks(parentElement, elements) {
    if (!elements || elements.length === 0) return;

    let currentList = null;
    let listStack = [];
    let currentIndentLevel = 0;

    // Create fragment at the beginning
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < elements.length; i++) {
        const item = elements[i];
        const { element, indentLevel, isSectionHeader, sectionHeaderLevel } = item;

        if (!element || indentLevel === undefined) continue;

        if (element.style.display === "none") {
            continue;
        }

        if (isSectionHeader) {
            if (sectionHeaderLevel === 0) {
                const sectionHeader = document.createElement("h2");
                sectionHeader.innerText = element.dataset.sectionInd;
                fragment.appendChild(sectionHeader);
            } else {
                const sectionHeader = document.createElement("h4");
                sectionHeader.classList.add("sub-header");
                sectionHeader.innerText = element.dataset.sectionInd;
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

        // Create list item and link
        const listItem = document.createElement("li");
        const link = document.createElement("a");

        // Get element ID, fallback to previous element's ID if empty
        const elementId = element.id;

        if (elementId === "") {
            // console.log(`Element Quick Link (at screen top) with text **${element.innerText}** skipped, no ID given`);
            continue; // Skip if no valid ID
        }

        link.href = `#${elementId}`;

        if (item.custom_name) {
            link.innerText = item.custom_name;
        } else {
            link.innerText = window.QuickLinksUtils.getElementTitle(element);
        }

        listItem.appendChild(link);

        // Handle nesting
        if (indentLevel > currentIndentLevel) {
            // Need to create nested lists to reach the desired indent level
            while (currentIndentLevel < indentLevel) {
                const newList = document.createElement("ul");

                if (listStack[listStack.length - 1].lastElementChild) {
                    listStack[listStack.length - 1].lastElementChild.appendChild(newList);
                } else {
                    // If there's no last element, create a dummy item
                    const dummyItem = document.createElement("li");
                    dummyItem.textContent = "Untitled";
                    listStack[listStack.length - 1].appendChild(dummyItem);
                    dummyItem.appendChild(newList);
                }

                listStack.push(newList);
                currentIndentLevel++;
            }
        } else if (indentLevel < currentIndentLevel) {
            // Go back up the nesting levels
            while (listStack.length > 1 && currentIndentLevel > indentLevel) {
                listStack.pop();
                currentIndentLevel--;
            }
        }

        // Add list item to current list
        if (listStack.length > 0) {
            listStack[listStack.length - 1].appendChild(listItem);
        }
    }

    parentElement.appendChild(fragment);
}

/**
 * Creates a fixed sidebar TOC by cloning the top ToC container
 * Only visible at wide viewports via CSS
 */
function initializeSidebarToc() {
    if (document.body.dataset.skipToc === "true") return;

    const tocContainer = document.querySelector(".quick-links-container");
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

    toggle.addEventListener("click", function () {
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
 * sits flush to the left of the content, regardless of scrollbar width
 */
function positionSidebarToc(sidebar) {
    function update() {
        const firstContainer = document.querySelector(".content-window .content-container");
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

    update();

    let resizeTimer;
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(update, 100);
    });
}

/**
 * Adds collapse toggles to each li that contains a nested ul in the sidebar TOC
 */
function setupSidebarSubToggles(container) {
    const lisWithChildren = container.querySelectorAll("li:has(> ul)");

    for (const li of lisWithChildren) {
        const childUl = li.querySelector(":scope > ul");
        if (!childUl) continue;

        childUl.style.display = "none";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sidebar-toc-sub-toggle";
        btn.setAttribute("aria-label", "Toggle sub-items");
        btn.textContent = "▸";

        li.insertBefore(btn, li.firstChild);

        btn.addEventListener("click", function (e) {
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
