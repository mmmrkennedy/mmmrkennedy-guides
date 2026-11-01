/**
 * Eleventy transform to auto-generate quick links navigation
 * Scans page content and builds table of contents in .quick-links-container
 */
function generateQuickLinks(document) {
    // Skip TOC generation if the page opts out
    if (document.body?.dataset?.skipToc === "true") return false;

    let container = document.querySelector(".quick-links-container");
    if (!container) {
        // Create the container and insert it before the first .content-container
        container = document.createElement("div");
        container.className = "quick-links-container";
        const firstSection = document.querySelector(".content-container");
        if (!firstSection) return false;
        firstSection.parentNode.insertBefore(container, firstSection);
    }

    // Clear existing manual content
    container.innerHTML = "";

    // Build navigation from page structure
    const navStructure = buildNavStructure(document);
    renderNavigation(container, navStructure);
    renderSidebarToc(document, container);
    addContentsSubToggles(document, container);

    return true;
}

/**
 * Builds navigation structure from page content
 * Groups items by section header
 */
function buildNavStructure(document) {
    const sections = [];
    const containers = document.querySelectorAll("div.content-container");
    let currentSection = null;

    for (const container of containers) {
        if (shouldExcludeFromNav(container)) continue;

        // Check if this container starts a new section
        if (container.dataset.sectionInd) {
            const sectionLevel = container.dataset.sectionHeaderLevel || "0";

            // Create new section
            currentSection = {
                sectionTitle: container.dataset.sectionInd,
                sectionLevel,
                items: [],
            };
            sections.push(currentSection);
        }

        // If no section exists yet, create a default one
        if (!currentSection) {
            currentSection = {
                sectionTitle: null,
                sectionLevel: "0",
                items: [],
            };
            sections.push(currentSection);
        }

        // Add main container link to current section
        currentSection.items.push({
            element: container,
            indent: 0,
            isMain: true,
        });

        // Find sub-items within this container
        const subItems = container.querySelectorAll(".title-tier-2, .title-tier-3, .title-tier-4");

        for (const [index, subItem] of subItems.entries()) {
            if (shouldExcludeFromNav(subItem)) continue;

            // Calculate indent level. tier-4 looks like tier-3 but nests one
            // level deeper in the Contents list.
            let indent = 1;
            if (subItem.classList.contains("title-tier-4") && index !== 0) {
                indent = 2;
            }
            if (subItem.dataset.customIndent) {
                indent = parseInt(subItem.dataset.customIndent, 10);
            }

            // Handle multiple links for same element
            if (subItem.dataset.customQuickLink) {
                const names = subItem.dataset.customQuickLink.split(";");
                if (!subItem.id) subItem.id = names[0]; // Set ID from first name

                for (const name of names) {
                    currentSection.items.push({
                        element: subItem,
                        indent,
                        customName: name,
                    });
                }
            } else {
                currentSection.items.push({
                    element: subItem,
                    indent,
                });
            }
        }
    }

    return sections;
}

/**
 * Renders navigation structure to DOM
 */
function renderNavigation(container, structure) {
    const document = container.ownerDocument;

    for (const section of structure) {
        // Add section header
        if (section.sectionTitle) {
            const header = document.createElement(section.sectionLevel === "0" ? "h2" : "h4");
            if (section.sectionLevel !== "0") {
                header.className = "sub-header";
            }
            header.textContent = section.sectionTitle;
            container.appendChild(header);
        }

        // Create ONE list for this entire section
        const rootList = document.createElement("ul");
        container.appendChild(rootList);

        // Process all items in this section
        let currentIndent = 0;
        const listStack = [rootList];

        for (const item of section.items) {
            const link = createNavLink(document, item.element, item.customName);
            if (!link) continue;

            // Adjust nesting level based on indent
            while (currentIndent < item.indent) {
                const nestedList = document.createElement("ul");
                const lastItem = listStack[listStack.length - 1].lastElementChild;

                if (lastItem) {
                    lastItem.appendChild(nestedList);
                } else {
                    // No parent item, create dummy
                    const dummyItem = document.createElement("li");
                    dummyItem.style.display = "none";
                    listStack[listStack.length - 1].appendChild(dummyItem);
                    dummyItem.appendChild(nestedList);
                }

                listStack.push(nestedList);
                currentIndent++;
            }

            while (currentIndent > item.indent && listStack.length > 1) {
                listStack.pop();
                currentIndent--;
            }

            listStack[listStack.length - 1].appendChild(link);
        }
    }
}

/**
 * Pre-renders the fixed sidebar TOC from the inline one.
 *
 * This used to be cloned client-side at DOMContentLoaded. On a throttled device
 * that landed ~1s after first contentful paint — the guide was fully readable
 * while the sidebar was still missing — because it had to wait for the whole
 * document to parse, then the core bundle, then five earlier init steps.
 * Shipping it in the HTML lets it paint with everything else; quick-links.ts
 * attaches the behaviour to this markup.
 */
function renderSidebarToc(document, tocContainer) {
    document.querySelector(".sidebar-toc")?.remove();
    if (!tocContainer.children.length) return;

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

    const body = document.createElement("div");
    body.className = "sidebar-toc-body";
    for (const child of tocContainer.children) {
        body.appendChild(child.cloneNode(true));
    }
    sidebar.appendChild(body);

    addSidebarSubToggles(document, body);

    // First in <main>, so it streams in before the guide body and its sticky
    // travel ends where the guide does, clear of the footer.
    document.querySelector("main")?.prepend(sidebar);
}

/**
 * Emits the collapse toggle for every sidebar item that has nested children.
 * Sub-lists ship collapsed; quick-links.ts only has to attach the click handlers.
 */
function addSidebarSubToggles(document, container) {
    for (const li of container.querySelectorAll("li")) {
        const childUl = li.querySelector(":scope > ul");
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
 * Emits the phone contents list's expand buttons. Runs after the sidebar is
 * cloned from this list, because the sidebar has toggles of its own. Stylesheet
 * shows them and hides the sub-lists on phones only, so wider screens are
 * untouched; quick-links.ts attaches the click handler.
 */
function addContentsSubToggles(document, container) {
    for (const li of container.querySelectorAll("li")) {
        if (!li.querySelector(":scope > ul")) continue;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "quick-links-sub-toggle";
        btn.setAttribute("aria-label", "Toggle sub-items");
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = "▸";

        li.insertBefore(btn, li.firstChild);
    }
}

/**
 * Creates a navigation link element
 */
function createNavLink(document, element, customName = null) {
    if (!element.id) return null;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${element.id}`;

    // Determine link text
    if (customName) {
        a.textContent = customName;
    } else if (element.children.length > 0) {
        a.textContent = element.children[0].textContent;
    } else {
        a.textContent = element.textContent;
    }

    li.appendChild(a);
    return li;
}

/**
 * Checks if element should be excluded from navigation
 */
function shouldExcludeFromNav(element) {
    // The solver components' own classes (solver-container, solver-output,
    // solver-symbol-select) are deliberately not here: this transform runs
    // before prerenderSolvers, so a page's solver markup does not exist yet
    // when the nav is built. Adding them back would only take effect if that
    // order changed.
    const excludedClasses = ["stats", "weapon-desc"];

    // Check element and all ancestors for excluded classes
    let current = element;
    while (current) {
        if (current.classList) {
            for (const className of excludedClasses) {
                if (current.classList.contains(className)) return true;
            }
        }
        current = current.parentElement;
    }

    return element.dataset?.boolQuickLink === "false";
}

module.exports = { generateQuickLinks };
