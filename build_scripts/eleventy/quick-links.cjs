// Headings take about twice the height of a link. At this many rows the list is
// taller than a phone screen.
const LONG_CONTENTS_ROWS = 24;

function generateQuickLinks(document) {
    if (document.body?.dataset?.skipToc === "true") return false;

    let container = document.querySelector(".quick-links-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "quick-links-container";
        const firstSection = document.querySelector(".content-container");
        if (!firstSection) return false;
        firstSection.parentNode.insertBefore(container, firstSection);
    }

    container.innerHTML = "";

    const navStructure = buildNavStructure(document);
    renderNavigation(container, navStructure);
    renderSidebarToc(document, container);
    addContentsSubToggles(document, container);
    addContentsShowAll(document, container);

    return true;
}

function buildNavStructure(document) {
    const sections = [];
    const containers = document.querySelectorAll("div.content-container");
    let currentSection = null;

    for (const container of containers) {
        if (shouldExcludeFromNav(container)) continue;

        if (container.dataset.sectionInd) {
            const sectionLevel = container.dataset.sectionHeaderLevel || "0";

            currentSection = {
                sectionTitle: container.dataset.sectionInd,
                sectionLevel,
                items: [],
            };
            sections.push(currentSection);
        }

        if (!currentSection) {
            currentSection = {
                sectionTitle: null,
                sectionLevel: "0",
                items: [],
            };
            sections.push(currentSection);
        }

        currentSection.items.push({
            element: container,
            indent: 0,
            isMain: true,
        });

        // [data-custom-quick-link] gives a non-heading (list item, solver) its own entry.
        const subItems = container.querySelectorAll(".title-tier-2, .title-tier-3, .title-tier-4, [data-custom-quick-link]");

        for (const [index, subItem] of subItems.entries()) {
            if (shouldExcludeFromNav(subItem)) continue;

            // tier-4 looks like tier-3 but nests one level deeper here.
            let indent = 1;
            if (subItem.classList.contains("title-tier-4") && index !== 0) {
                indent = 2;
            }
            if (subItem.dataset.customIndent) {
                indent = parseInt(subItem.dataset.customIndent, 10);
            }

            if (subItem.dataset.customQuickLink) {
                const names = subItem.dataset.customQuickLink.split(";");
                if (!subItem.id) subItem.id = names[0];

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

function renderNavigation(container, structure) {
    const document = container.ownerDocument;

    for (const section of structure) {
        if (section.sectionTitle) {
            const header = document.createElement(section.sectionLevel === "0" ? "h2" : "h4");
            if (section.sectionLevel !== "0") {
                header.className = "sub-header";
            }
            header.textContent = section.sectionTitle;
            container.appendChild(header);
        }

        const rootList = document.createElement("ul");
        container.appendChild(rootList);

        let currentIndent = 0;
        const listStack = [rootList];

        for (const item of section.items) {
            const link = createNavLink(document, item.element, item.customName);
            if (!link) continue;

            while (currentIndent < item.indent) {
                const nestedList = document.createElement("ul");
                const lastItem = listStack[listStack.length - 1].lastElementChild;

                if (lastItem) {
                    lastItem.appendChild(nestedList);
                } else {
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

/** Built at build time so it paints with the page; quick-links.ts adds the behaviour. */
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

/** CSS caps a long list's height on phones. Must run after renderSidebarToc clones the list. */
function addContentsShowAll(document, container) {
    const links = container.querySelectorAll(":scope > ul > li").length;
    const headings = container.querySelectorAll(":scope > h2, :scope > h4").length;
    if (links + headings * 2 < LONG_CONTENTS_ROWS) return;

    container.classList.add("quick-links-container--long");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-links-show-all";
    btn.textContent = "Show all";
    container.appendChild(btn);
}

/** Phone-only (via CSS). Runs after renderSidebarToc, since the sidebar has its own toggles. */
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

function createNavLink(document, element, customName = null) {
    if (!element.id) return null;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = `#${element.id}`;

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

function shouldExcludeFromNav(element) {
    // Solver classes aren't needed: this runs before prerenderSolvers, so solver
    // markup doesn't exist yet.
    const excludedClasses = ["stats", "weapon-desc"];

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
