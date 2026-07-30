/**
 * Ad management: inline ads (every other content-container) + right sidebar ad
 * Toggle persisted in localStorage under key 'ads-mode'
 * Modes: "full" (default), "minimal" (sidebars only), "hidden"
 *
 * Injection happens once per type; body classes control visibility thereafter.
 */

type AdsMode = "full" | "minimal" | "hidden";

const ADS_KEY = "ads-mode";
const MOBILE_MAX_WIDTH = 768;
const injected = { sidebars: false, inline: false, multiplex: false };

/**
 * Site-wide kill switch. While true, ads are forced to "hidden" for everyone —
 * a stored 'ads-mode' preference is ignored, no slots are injected, and the
 * toggle button is hidden. Flip to false to restore normal behaviour.
 */
const ADS_DISABLED = true;

function isMobileViewport(): boolean {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
}

function getAdsMode(): AdsMode {
    if (ADS_DISABLED) return "hidden";
    const stored = localStorage.getItem(ADS_KEY);
    return stored === "minimal" || stored === "hidden" ? stored : "full";
}

function buildInlineAdHTML(): string {
    return `<ins class="adsbygoogle"
     style="display:block; width:100%;"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="1841965824"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>`;
}

function buildMultiplexAdHTML(): string {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-format="autorelaxed"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="1787048942"></ins>`;
}

function buildSidebarAdHTML(): string {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="5840873517"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>`;
}

const ADSENSE_SRC =
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2164582284838563";

/**
 * Load adsbygoogle.js on demand, once.
 *
 * This module owns the loader rather than the page templates: the tag used to
 * sit in <head> on every page, so the whole Google stack (~1MB over ~28
 * requests across pagead2, fundingchoicesmessages, adtrafficquality and
 * doubleclick) was fetched even while ADS_DISABLED was true and not one slot
 * was ever injected. Keeping it here means the single flag below is the only
 * thing that decides whether Google is contacted at all, and a reader who sets
 * ads to "hidden" never pays for it either.
 *
 * Safe to call before any pushAd(): window.adsbygoogle is a plain queue array
 * until the script arrives, and AdSense drains whatever it finds on load.
 */
let adSenseRequested = false;
function ensureAdSenseLoader(): void {
    if (adSenseRequested || ADS_DISABLED) return;
    adSenseRequested = true;
    const script = document.createElement("script");
    script.src = ADSENSE_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => console.warn("AdSense loader failed to load");
    document.head.appendChild(script);
}

function pushAd(): void {
    try {
        ensureAdSenseLoader();
        (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
        console.warn("AdSense push failed:", e);
    }
}

const AD_INTERVAL_PX_FULL = 2000;

function insertInlineAdSlot(afterContainer: Element, contentPxBefore: number): void {
    const wrapper = document.createElement("div");
    wrapper.className = "ad-inline";
    wrapper.style.display = "none";
    wrapper.dataset.contentPxBefore = String(contentPxBefore);
    wrapper.innerHTML = buildInlineAdHTML();
    afterContainer.after(wrapper);
}

function injectInlineAdSlots(): void {
    if (isSolverOnlyPage()) return;

    const containers = Array.from(
        document.querySelectorAll<HTMLElement>(".content-window .content-container")
    );
    if (containers.length === 0) return;

    // Exclude the last container — reserved for the multiplex ad
    const eligible = containers.slice(0, -1);

    let cumulative = 0;
    eligible.forEach((container) => {
        cumulative += container.offsetHeight;
        insertInlineAdSlot(container, cumulative);
    });
}

function applyInlineInterval(intervalPx: number): void {
    const slots = document.querySelectorAll<HTMLElement>(".content-window .ad-inline");
    let lastShownPx = 0;
    slots.forEach((slot) => {
        const px = Number(slot.dataset.contentPxBefore || "0");
        if (px - lastShownPx >= intervalPx) {
            slot.style.display = "";
            if (!slot.dataset.pushed) {
                pushAd();
                slot.dataset.pushed = "1";
            }
            lastShownPx = px;
        } else {
            slot.style.display = "none";
        }
    });
}

function isSolverOnlyPage(): boolean {
    return document.querySelector(".solver-only-page") !== null;
}

function injectMultiplexAd(): void {
    if (isSolverOnlyPage()) return;

    const els = document.querySelectorAll(".content-window .content-container, .content-window .ad-inline");
    if (els.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ad-multiplex";
    wrapper.innerHTML = buildMultiplexAdHTML();
    els[els.length - 1].after(wrapper);
    pushAd();
}

function isIndexPage(): boolean {
    const path = window.location.pathname;
    return path === "/" || path === "/index.html";
}

function injectSidebarAd(): void {
    if (document.querySelector(".ad-right-sidebar")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ad-right-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    // positionSidebarAd sizes the slot and pushes once it first reaches a
    // usable width. AdSense reads availableWidth at push time, so we must
    // never push an unpositioned (0-width) slot.
    positionSidebarAd(wrapper);
}

function getSidebarGap(): number {
    return isSolverOnlyPage() ? 80 : 40;
}

function getContentBounds(): { minLeft: number; maxRight: number } {
    const els = document.querySelectorAll(
        ".content-window .content-container, .content-window .ad-inline, .content-window .ad-multiplex, .solver-only-page .ad-inline"
    );
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (const el of els) {
        const r = el.getBoundingClientRect();
        minLeft = Math.min(minLeft, r.left);
        maxRight = Math.max(maxRight, r.right);
    }
    return { minLeft, maxRight };
}

function positionSidebarAd(adEl: HTMLElement): void {
    let pushed = false;
    function update(): void {
        const { maxRight } = getContentBounds();
        if (maxRight === -Infinity) { adEl.style.display = "none"; return; }
        const gap = getSidebarGap();
        const margin = 8;
        const leftEdge = maxRight + gap;
        const width = window.innerWidth - leftEdge - margin;
        if (width < 100) { adEl.style.display = "none"; return; }
        adEl.style.display = "block";
        adEl.style.left = `${leftEdge}px`;
        adEl.style.width = `${width}px`;
        // Push only once the slot has a real width — handles the case where
        // the sidebar is injected too narrow and only becomes usable on resize.
        if (!pushed) { pushed = true; pushAd(); }
    }
    update();
    let timer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}

function injectLeftSidebarAd(): void {
    if (document.querySelector(".ad-left-sidebar")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "ad-left-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    // positionLeftSidebarAd sizes the slot and pushes once usable (see injectSidebarAd).
    positionLeftSidebarAd(wrapper);
}

function positionLeftSidebarAd(adEl: HTMLElement): void {
    let pushed = false;
    function update(): void {
        const { minLeft } = getContentBounds();
        if (minLeft === Infinity) { adEl.style.display = "none"; return; }
        const gap = getSidebarGap();
        const margin = 8;
        const rightEdge = minLeft - gap;
        const width = rightEdge - margin;
        if (width < 100) { adEl.style.display = "none"; return; }
        adEl.style.display = "block";
        adEl.style.left = `${margin}px`;
        adEl.style.width = `${width}px`;
        // Push only once the slot has a real width (see positionSidebarAd).
        if (!pushed) { pushed = true; pushAd(); }
    }
    update();
    let timer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}

function applyMode(mode: AdsMode): void {
    document.body.classList.remove("ads-full", "ads-minimal", "ads-hidden");
    document.body.classList.add(`ads-${mode}`);

    const needSidebars = mode !== "hidden" && !isMobileViewport();
    const needMultiplex = mode !== "hidden";
    const needInline = mode === "full";

    if (needSidebars && !injected.sidebars) {
        injectSidebarAd();
        if (isIndexPage() || isSolverOnlyPage()) injectLeftSidebarAd();
        injected.sidebars = true;
    }

    if (needInline && !injected.inline) {
        if (!isIndexPage()) {
            injectInlineAdSlots();
        }
        injected.inline = true;
    }

    if (needMultiplex && !injected.multiplex) {
        injectMultiplexAd();
        injected.multiplex = true;
    }

    if (needInline && !isIndexPage() && !isSolverOnlyPage()) {
        applyInlineInterval(AD_INTERVAL_PX_FULL);
    }

    // Re-sync sidebar positions after body class change lifts any display:none override
    if (needSidebars) {
        window.dispatchEvent(new Event("resize"));
    }
}

function setMode(mode: AdsMode): void {
    if (ADS_DISABLED) return;
    localStorage.setItem(ADS_KEY, mode);
    applyMode(mode);
}

function initAdToggle(): void {
    const btn = document.getElementById("ad-toggle-btn");
    if (!btn) return;

    const indicator = document.getElementById("ad-mode-indicator");

    // Nothing to toggle while ads are disabled site-wide — hide the control.
    if (ADS_DISABLED) {
        btn.style.display = "none";
        if (indicator) indicator.style.display = "none";
        return;
    }

    const NEXT_MODE: Record<AdsMode, AdsMode> = { full: "minimal", minimal: "hidden", hidden: "full" };
    const NEXT_LABEL: Record<AdsMode, string> = { full: "Minimal Ads", minimal: "Hide Ads", hidden: "Show Ads" };
    const MODE_LABEL: Record<AdsMode, string> = { full: "showing: full", minimal: "showing: minimal", hidden: "showing: none" };

    function updateLabel(mode: AdsMode): void {
        btn!.setAttribute("aria-pressed", String(mode === "full"));
        btn!.textContent = NEXT_LABEL[mode];
        if (indicator) indicator.textContent = MODE_LABEL[mode];
    }

    updateLabel(getAdsMode());

    btn.addEventListener("click", () => {
        const next = NEXT_MODE[getAdsMode()];
        setMode(next);
        updateLabel(next);
    });
}

function initAds(): void {
    initAdToggle();

    function start(): void {
        setTimeout(() => applyMode(getAdsMode()), 150);
    }

    // Delay until layout is stable and React solvers have mounted
    if (document.readyState === "complete") {
        start();
    } else {
        window.addEventListener("load", start);
    }

    // Re-apply if viewport crosses mobile→desktop so sidebars can load
    let wasMobile = isMobileViewport();
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const nowMobile = isMobileViewport();
            if (wasMobile && !nowMobile) applyMode(getAdsMode());
            wasMobile = nowMobile;
        }, 200);
    });
}

/** Debug helper (exposed on window.Ads): tints every ad slot red. */
function makeAdsRed(): void {
    const styleId = "ads-red-override";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
        .ad-inline, .ad-multiplex, .ad-infeed, .ad-right-sidebar, .ad-left-sidebar {
            background-color: red !important;
            border: 2px solid darkred !important;
        }
    `;
    document.head.appendChild(style);
}

window.Ads = { initAds, makeAdsRed };

// Self-bootstrap as an independent async island. The ads bundle is loaded with
// `async`, decoupled from the core init in scripts.ts, so a slow, blocked, or
// failed ad payload never delays nav/lightbox/etc. `async` means this file can
// execute before or after DOMContentLoaded, so guard on readyState.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAds);
} else {
    initAds();
}
