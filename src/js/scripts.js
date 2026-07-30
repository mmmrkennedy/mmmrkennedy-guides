"use strict";
window.navigateToIndex = function () {
    window.location.href = "/";
};
/*
=======================================
LAZY LOAD IMAGES
=======================================
 */
document.addEventListener("DOMContentLoaded", () => {
    try {
        const imageCache = new Map();
        function loadImage(imgUrl) {
            if (imageCache.has(imgUrl))
                return;
            const img = new Image();
            img.onerror = () => console.error("Failed to load image:", imgUrl);
            img.src = imgUrl;
            imageCache.set(imgUrl, img);
        }
        const imageLinks = document.querySelectorAll("a.lightbox-trigger");
        if (imageLinks.length === 0)
            return;
        imageLinks.forEach((aTag) => {
            const imageUrl = aTag.getAttribute("href");
            if (!imageUrl)
                return;
            aTag.addEventListener("pointerenter", () => loadImage(imageUrl), { once: true });
            aTag.addEventListener("click", () => loadImage(imageUrl), { once: true });
        });
    }
    catch (error) {
        console.error("Error initializing lightbox preloading:", error);
    }
});
/*
=======================================
HOVER PREFETCH FOR INTERNAL LINKS
=======================================
Disabled 2026-07-24 in favour of Cloudflare Speed Brain, which prefetches on the
same conservative hover/pointerdown signal at the edge. While Speed Brain is on
it owns every request carrying `Sec-Purpose: prefetch` and answers the ones it
considers ineligible with an empty 503 (`Cf-Speculation-Refused: prefetch
refused: not eligible`), so this code could only ever produce a wasted round
trip. Flip the flag back on if Speed Brain is ever turned off.
 */
const HOVER_PREFETCH_ENABLED = false;
document.addEventListener("DOMContentLoaded", () => {
    if (!HOVER_PREFETCH_ENABLED)
        return;
    try {
        // Track which pages we've already prefetched
        const prefetchedUrls = new Set();
        function prefetchPage(url) {
            if (prefetchedUrls.has(url))
                return;
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
        const htmlLinks = document.querySelectorAll("a[data-prefetchable]:not(.disabled)");
        // Only the index carries prefetchable links; every guide page hits this.
        if (htmlLinks.length === 0)
            return;
        htmlLinks.forEach((link) => {
            const href = link.getAttribute("href");
            // Skip external links, anchors, and disabled links
            if (!href || href.startsWith("http") || href.startsWith("#"))
                return;
            // Prefetch on first hover ('once: true' removes the listener afterwards)
            link.addEventListener("mouseenter", () => prefetchPage(href), { once: true });
        });
        // Expose helpers for debugging
        window.isPrefetched = (url) => prefetchedUrls.has(url);
        window.getPrefetchedUrls = () => Array.from(prefetchedUrls);
    }
    catch (error) {
        console.error("Error initializing page prefetch:", error);
    }
});
async function loadSolverComponent(insert) {
    const path = insert.dataset.solverHtmlPath;
    if (!path)
        return null;
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
    }
    catch (error) {
        console.error(`Error loading solver component at ${path}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        insert.innerHTML = `<p class="error" style="color: red; padding: 10px; border: 1px solid red; background: rgba(255,0,0,0.1);">
            Failed to load solver component: ${message}
        </p>`;
        return null;
    }
}
async function includeSolverComponent() {
    try {
        const solverInserts = document.querySelectorAll(".solver-insert");
        if (solverInserts.length === 0)
            return;
        const eventNames = [];
        const loadPromises = [];
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
            }
            else if (result.status === "rejected") {
                console.error(`Solver component ${index} failed to load:`, result.reason);
            }
        });
        // Dispatch events for successfully loaded components
        for (const eventName of eventNames) {
            try {
                document.dispatchEvent(new CustomEvent(eventName));
            }
            catch (error) {
                console.error(`Error dispatching event ${eventName}:`, error);
            }
        }
    }
    catch (error) {
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
        const initializationSteps = [
            // Runs first: a deep link into a collapsed path has to open that path
            // before anything below tries to scroll the target into view.
            { name: "Path Tabs", fn: () => window.PathTabs?.initPathTabs() },
            { name: "Scroll Manager", fn: () => window.ScrollManager?.initHistoryManagement() },
            {
                name: "Scroll Manager Clear",
                fn: () => {
                    const hash = window.location.hash;
                    if (!hash || hash.length <= 1) {
                        // Returning to an entry we stamped on the way out (Back from
                        // another guide, without bfcache) — put the reader back where
                        // they were rather than resetting them to the top.
                        if (window.ScrollManager?.restoreStampedScroll())
                            return;
                        window.ScrollManager?.clearHashAndScrollTop();
                        return;
                    }
                    const id = hash.substring(1);
                    // "replace", not "push": this history entry already exists — the
                    // reader arrived at this URL. Pushing a duplicate meant their
                    // first Back press just re-landed them on the same page at the
                    // top instead of going back.
                    window.ScrollManager?.scrollToElement(id, "replace");
                    // The browser performs its own fragment scroll once loading
                    // finishes, which knows nothing about our fixed header offset
                    // or any wider frame the target asked for via data-scroll-with.
                    // Re-assert afterwards, leaving history untouched.
                    window.addEventListener("load", () => {
                        requestAnimationFrame(() => window.ScrollManager?.scrollToElement(id, "none"));
                    }, { once: true });
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
            }
            catch (error) {
                console.error(`Error initializing ${step.name}:`, error);
            }
        }
    }
    catch (error) {
        console.error("Critical error during website initialization:", error);
    }
});
