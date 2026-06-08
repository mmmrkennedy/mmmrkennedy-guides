window.navigateToIndex = function (): void {
    window.location.href = "/";
};

/*
=======================================
LAZY LOAD IMAGES
=======================================
 */
document.addEventListener("DOMContentLoaded", () => {
    try {
        const imageCache = new Map<string, HTMLImageElement>();

        function loadImage(imgUrl: string): void {
            if (imageCache.has(imgUrl)) return;
            const img = new Image();
            img.onerror = () => console.error("Failed to load image:", imgUrl);
            img.src = imgUrl;
            imageCache.set(imgUrl, img);
        }

        const imageLinks = document.querySelectorAll<HTMLAnchorElement>("a.lightbox-trigger");
        if (imageLinks.length === 0) return;

        imageLinks.forEach((aTag) => {
            const imageUrl = aTag.getAttribute("href");
            if (!imageUrl) return;
            aTag.addEventListener("pointerenter", () => loadImage(imageUrl), { once: true });
            aTag.addEventListener("click", () => loadImage(imageUrl), { once: true });
        });
    } catch (error) {
        console.error("Error initializing lightbox preloading:", error);
    }
});

/*
=======================================
HOVER PREFETCH FOR INTERNAL LINKS
=======================================
 */
document.addEventListener("DOMContentLoaded", () => {
    try {
        // Track which pages we've already prefetched
        const prefetchedUrls = new Set<string>();

        function prefetchPage(url: string): void {
            if (prefetchedUrls.has(url)) return;
            prefetchedUrls.add(url);

            const link = document.createElement("link");
            link.rel = "prefetch";
            link.href = url;
            link.as = "document";

            link.onerror = () => {
                console.warn("Failed to prefetch:", url);
                // Remove from set so we can retry if needed
                prefetchedUrls.delete(url);
            };

            document.head.appendChild(link);
        }

        // Find all internal links (excluding external, anchors, and disabled ones)
        const htmlLinks = document.querySelectorAll<HTMLAnchorElement>("a[data-prefetchable]:not(.disabled)");
        if (htmlLinks.length === 0) {
            console.warn("No HTML links found to prefetch");
            return;
        }

        htmlLinks.forEach((link) => {
            const href = link.getAttribute("href");

            // Skip external links, anchors, and disabled links
            if (!href || href.startsWith("http") || href.startsWith("#")) return;

            // Prefetch on first hover ('once: true' removes the listener afterwards)
            link.addEventListener("mouseenter", () => prefetchPage(href), { once: true });
        });

        // Expose helpers for debugging
        window.isPrefetched = (url: string): boolean => prefetchedUrls.has(url);
        window.getPrefetchedUrls = (): string[] => Array.from(prefetchedUrls);
    } catch (error) {
        console.error("Error initializing page prefetch:", error);
    }
});

async function loadSolverComponent(insert: HTMLElement): Promise<string | null> {
    const path = insert.dataset.solverHtmlPath;
    if (!path) return null;

    try {
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const html = await response.text();
        if (!html.trim()) {
            throw new Error("Empty response received");
        }

        insert.innerHTML = html;

        // Extract event name from path
        return path.split("/").pop()?.replace(/\.html$/, "") ?? null;
    } catch (error) {
        console.error(`Error loading solver component at ${path}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        insert.innerHTML = `<p class="error" style="color: red; padding: 10px; border: 1px solid red; background: rgba(255,0,0,0.1);">
            Failed to load solver component: ${message}
        </p>`;
        return null;
    }
}

async function includeSolverComponent(): Promise<void> {
    try {
        const solverInserts = document.querySelectorAll<HTMLElement>(".solver-insert");
        if (solverInserts.length === 0) return;

        const eventNames: string[] = [];
        const loadPromises: Promise<string | null>[] = [];

        // Use Promise.allSettled to handle partial failures gracefully
        for (const insert of solverInserts) {
            if (!insert.dataset.solverHtmlPath) {
                console.warn("Solver insert missing solverHtmlPath data attribute:", insert);
                continue;
            }
            loadPromises.push(loadSolverComponent(insert));
        }

        const results = await Promise.allSettled(loadPromises);

        // Collect event names from successful loads
        results.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value) {
                eventNames.push(result.value);
            } else if (result.status === "rejected") {
                console.error(`Solver component ${index} failed to load:`, result.reason);
            }
        });

        // Dispatch events for successfully loaded components
        for (const eventName of eventNames) {
            try {
                document.dispatchEvent(new CustomEvent(eventName));
            } catch (error) {
                console.error(`Error dispatching event ${eventName}:`, error);
            }
        }
    } catch (error) {
        console.error("Error in includeSolverComponent:", error);
    }
}

/*
=======================================
MAIN INITIALIZATION
=======================================
 */
document.addEventListener("DOMContentLoaded", () => {
    try {
        const initializationSteps: { name: string; fn: () => void }[] = [
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
            { name: "Legend", fn: () => window.Legend?.initLegend() },
            { name: "Solver Buttons", fn: () => window.LinkProcessor?.setupSolverButtons() },
            { name: "Quick Links", fn: () => window.QuickLinks?.initializeQuickLinks() },
            { name: "Sidebar TOC", fn: () => window.QuickLinks?.initializeSidebarToc() },
            { name: "Lightbox Init", fn: () => window.Lightbox?.initLightbox() },
            { name: "Reveal Button Build", fn: () => window.SolverButtonProcessor?.initRevealButtons() },
            { name: "Solver Components", fn: () => void includeSolverComponent() },
            // Ads are NOT initialized here — ads.ts self-bootstraps as an
            // independent async island so it can't delay core interactivity.
        ];

        for (const step of initializationSteps) {
            try {
                step.fn();
            } catch (error) {
                console.error(`Error initializing ${step.name}:`, error);
            }
        }
    } catch (error) {
        console.error("Critical error during website initialization:", error);
    }
});
