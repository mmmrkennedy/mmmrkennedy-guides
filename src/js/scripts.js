window.navigateToIndex = function () {
    window.location.href = "/";
};

/*
=======================================
LAZY LOAD IMAGES
=======================================
 */
document.addEventListener("DOMContentLoaded", function () {
    try {
        const imageCache = new Map();

        function loadImage(imgUrl) {
            if (imageCache.has(imgUrl)) return;
            const img = new Image();
            img.onerror = () => console.error("Failed to load image:", imgUrl);
            img.src = imgUrl;
            imageCache.set(imgUrl, img);
        }

        const imageLinks = document.querySelectorAll("a.lightbox-trigger");

        if (imageLinks.length === 0) return;

        imageLinks.forEach((aTag) => {
            const imageUrl = aTag.getAttribute("href");
            aTag.addEventListener("pointerenter", () => loadImage(imageUrl), { once: true });
            aTag.addEventListener("click", () => loadImage(imageUrl), { once: true });
        });

    } catch (error) {
        console.error("Error initializing lightbox preloading:", error);
    }
});

document.addEventListener("DOMContentLoaded", function () {
    try {
        // Track which pages we've already prefetched
        const prefetchedUrls = new Set();

        // Helper function to prefetch a page
        function prefetchPage(url) {
            // Skip if already prefetched
            if (prefetchedUrls.has(url)) {
                return;
            }

            // Mark as prefetched
            prefetchedUrls.add(url);

            // Create prefetch link element
            const link = document.createElement("link");
            link.rel = "prefetch";
            link.href = url;
            link.as = "document";

            // Optional: Add event listeners to track success/failure
            link.onload = () => {
                // console.log("Prefetched:", url);
            };

            link.onerror = () => {
                console.warn("Failed to prefetch:", url);
                // Remove from set so we can retry if needed
                prefetchedUrls.delete(url);
            };

            // Add to document head
            document.head.appendChild(link);
        }

        // Find all internal links (excluding external, anchors, and disabled ones)
        const htmlLinks = document.querySelectorAll('a[data-prefetchable]:not(.disabled)')

        if (htmlLinks.length === 0) {
            console.warn("No HTML links found to prefetch");
            return;
        }

        // Add hover listeners to all links
        htmlLinks.forEach((link) => {
            const href = link.getAttribute("href");

            // Skip external links, anchors, and disabled links
            if (!href || href.startsWith("http") || href.startsWith("#")) {
                return;
            }

            // Prefetch on hover (mouseenter is better than mouseover)
            link.addEventListener(
                "mouseenter",
                () => {
                    // console.log(`Prefetched: ${link.getAttribute("href")}`);
                    prefetchPage(href);
                },
                { once: true },
            ); // 'once: true' removes listener after first trigger
        });

        // console.log(`Hover prefetch enabled for ${htmlLinks.length} links`);

        // Optional: Expose helper for debugging
        window.isPrefetched = function (url) {
            return prefetchedUrls.has(url);
        };

        window.getPrefetchedUrls = function () {
            return Array.from(prefetchedUrls);
        };
    } catch (error) {
        console.error("Error initializing page prefetch:", error);
    }
});


async function includeSolverComponent() {
    try {
        const solverInserts = document.querySelectorAll(".solver-insert");

        if (solverInserts.length === 0) {
            // console.log('No solver components found to load');
            return;
        }

        const event_names = [];
        const loadPromises = [];

        // Use Promise.allSettled to handle partial failures gracefully
        for (const insert of solverInserts) {
            if (!insert.dataset.solverHtmlPath) {
                console.warn("Solver insert missing solverHtmlPath data attribute:", insert);
                continue;
            }

            const loadPromise = loadSolverComponent(insert);
            loadPromises.push(loadPromise);
        }

        const results = await Promise.allSettled(loadPromises);

        // Collect event names from successful loads
        results.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value) {
                event_names.push(result.value);
            } else if (result.status === "rejected") {
                console.error(`Solver component ${index} failed to load:`, result.reason);
            }
        });

        // Dispatch events for successfully loaded components
        for (const eventName of event_names) {
            try {
                document.dispatchEvent(new CustomEvent(eventName));
                // console.log(`Dispatched event: ${eventName}`);
            } catch (error) {
                console.error(`Error dispatching event ${eventName}:`, error);
            }
        }

        // console.log(`Loaded ${event_names.length} solver components successfully`);
    } catch (error) {
        console.error("Error in includeSolverComponent:", error);
    }
}

async function loadSolverComponent(insert) {
    try {
        const response = await fetch(insert.dataset.solverHtmlPath);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();

        if (!html.trim()) {
            throw new Error("Empty response received");
        }

        insert.innerHTML = html;

        // Extract event name from path
        return insert.dataset.solverHtmlPath
            .split("/")
            .pop()
            .replace(/\.html$/, "");
    } catch (error) {
        console.error(`Error loading solver component at ${insert.dataset.solverHtmlPath}:`, error);
        insert.innerHTML = `<p class="error" style="color: red; padding: 10px; border: 1px solid red; background: rgba(255,0,0,0.1);">
            Failed to load solver component: ${error.message}
        </p>`;
        return null;
    }
}

/*
=======================================
MAIN INITIALIZATION
=======================================
 */
document.addEventListener("DOMContentLoaded", function () {
    try {
        // Initialize core utilities with error handling
        const initializationSteps = [
            { name: "Scroll Manager", fn: () => window.ScrollManager?.initHistoryManagement() },
            {
                name: "Scroll Manager Clear",
                fn: () => {
                    const hash = window.location.hash;
                    if (hash && hash.length > 1) {
                        window.ScrollManager?.scrollToElement(hash.substring(1));
                    } else {
                        window.ScrollManager?.clearHashAndScrollTop();
                    }
                },
            },
            { name: "Scroll Anchors", fn: () => window.ScrollManager?.scrollToAnchors() },
            { name: "Tutorial System", fn: () => window.TutorialSystem?.tutorialPopupInit() },
            { name: "Solver Buttons", fn: () => window.LinkProcessor?.setupSolverButtons() },
            { name: "Quick Links", fn: () => window.QuickLinks?.initializeQuickLinks() },
            { name: "Sidebar TOC", fn: () => window.QuickLinks?.initializeSidebarToc() },
            { name: "Lightbox Init", fn: () => window.Lightbox?.initLightbox() },
            { name: "Reveal Button Build", fn: () => window.SolverButtonProcessor?.initRevealButtons() },
            { name: "Solver Components", fn: includeSolverComponent },
        ];

        // Execute initialization steps with error handling
        for (const step of initializationSteps) {
            try {
                if (typeof step.fn === "function") {
                    step.fn();
                } else {
                    console.warn(`${step.name} function not available`);
                }
            } catch (error) {
                console.error(`Error initializing ${step.name}:`, error);
            }
        }
    } catch (error) {
        console.error("Critical error during website initialization:", error);
    }
});
