"use strict";
/**
 * Ad management: inline ads (every other content-container) + right sidebar ad
 * Toggle persisted in localStorage under key 'ads-mode'
 * Modes: "full" (default), "minimal" (sidebars only), "hidden"
 *
 * Injection happens once per type; body classes control visibility thereafter.
 */
const ADS_KEY = "ads-mode";
const MOBILE_MAX_WIDTH = 768;
const injected = { sidebars: false, inline: false, multiplex: false };
function isMobileViewport() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
}
function getAdsMode() {
    const stored = localStorage.getItem(ADS_KEY);
    return stored === "minimal" || stored === "hidden" ? stored : "full";
}
function buildInlineAdHTML() {
    return `<ins class="adsbygoogle"
     style="display:block; width:100%;"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="1841965824"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>`;
}
function buildMultiplexAdHTML() {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-format="autorelaxed"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="1787048942"></ins>`;
}
function buildSidebarAdHTML() {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="5840873517"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>`;
}
function pushAd() {
    try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
    }
    catch (e) {
        console.warn("AdSense push failed:", e);
    }
}
const AD_INTERVAL_PX_FULL = 2000;
function insertInlineAdSlot(afterContainer, contentPxBefore) {
    const wrapper = document.createElement("div");
    wrapper.className = "ad-inline";
    wrapper.style.display = "none";
    wrapper.dataset.contentPxBefore = String(contentPxBefore);
    wrapper.innerHTML = buildInlineAdHTML();
    afterContainer.after(wrapper);
}
function injectInlineAdSlots() {
    if (isSolverOnlyPage())
        return;
    const containers = Array.from(document.querySelectorAll(".content-window .content-container"));
    if (containers.length === 0)
        return;
    // Exclude the last container — reserved for the multiplex ad
    const eligible = containers.slice(0, -1);
    let cumulative = 0;
    eligible.forEach((container) => {
        cumulative += container.offsetHeight;
        insertInlineAdSlot(container, cumulative);
    });
}
function applyInlineInterval(intervalPx) {
    const slots = document.querySelectorAll(".content-window .ad-inline");
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
        }
        else {
            slot.style.display = "none";
        }
    });
}
function isSolverOnlyPage() {
    return document.querySelector(".solver-only-page") !== null;
}
function injectMultiplexAd() {
    if (isSolverOnlyPage())
        return;
    const els = document.querySelectorAll(".content-window .content-container, .content-window .ad-inline");
    if (els.length === 0)
        return;
    const wrapper = document.createElement("div");
    wrapper.className = "ad-multiplex";
    wrapper.innerHTML = buildMultiplexAdHTML();
    els[els.length - 1].after(wrapper);
    pushAd();
}
function isIndexPage() {
    const path = window.location.pathname;
    return path === "/" || path === "/index.html";
}
function injectSidebarAd() {
    if (document.querySelector(".ad-right-sidebar"))
        return;
    const wrapper = document.createElement("div");
    wrapper.className = "ad-right-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    // positionSidebarAd sizes the slot and pushes once it first reaches a
    // usable width. AdSense reads availableWidth at push time, so we must
    // never push an unpositioned (0-width) slot.
    positionSidebarAd(wrapper);
}
function getSidebarGap() {
    return isSolverOnlyPage() ? 80 : 40;
}
function getContentBounds() {
    const els = document.querySelectorAll(".content-window .content-container, .content-window .ad-inline, .content-window .ad-multiplex, .solver-only-page .ad-inline");
    let minLeft = Infinity;
    let maxRight = -Infinity;
    for (const el of els) {
        const r = el.getBoundingClientRect();
        minLeft = Math.min(minLeft, r.left);
        maxRight = Math.max(maxRight, r.right);
    }
    return { minLeft, maxRight };
}
function positionSidebarAd(adEl) {
    let pushed = false;
    function update() {
        const { maxRight } = getContentBounds();
        if (maxRight === -Infinity) {
            adEl.style.display = "none";
            return;
        }
        const gap = getSidebarGap();
        const margin = 8;
        const leftEdge = maxRight + gap;
        const width = window.innerWidth - leftEdge - margin;
        if (width < 100) {
            adEl.style.display = "none";
            return;
        }
        adEl.style.display = "block";
        adEl.style.left = `${leftEdge}px`;
        adEl.style.width = `${width}px`;
        // Push only once the slot has a real width — handles the case where
        // the sidebar is injected too narrow and only becomes usable on resize.
        if (!pushed) {
            pushed = true;
            pushAd();
        }
    }
    update();
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}
function injectLeftSidebarAd() {
    if (document.querySelector(".ad-left-sidebar"))
        return;
    const wrapper = document.createElement("div");
    wrapper.className = "ad-left-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    // positionLeftSidebarAd sizes the slot and pushes once usable (see injectSidebarAd).
    positionLeftSidebarAd(wrapper);
}
function positionLeftSidebarAd(adEl) {
    let pushed = false;
    function update() {
        const { minLeft } = getContentBounds();
        if (minLeft === Infinity) {
            adEl.style.display = "none";
            return;
        }
        const gap = getSidebarGap();
        const margin = 8;
        const rightEdge = minLeft - gap;
        const width = rightEdge - margin;
        if (width < 100) {
            adEl.style.display = "none";
            return;
        }
        adEl.style.display = "block";
        adEl.style.left = `${margin}px`;
        adEl.style.width = `${width}px`;
        // Push only once the slot has a real width (see positionSidebarAd).
        if (!pushed) {
            pushed = true;
            pushAd();
        }
    }
    update();
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}
function applyMode(mode) {
    document.body.classList.remove("ads-full", "ads-minimal", "ads-hidden");
    document.body.classList.add(`ads-${mode}`);
    const needSidebars = mode !== "hidden" && !isMobileViewport();
    const needMultiplex = mode !== "hidden";
    const needInline = mode === "full";
    if (needSidebars && !injected.sidebars) {
        injectSidebarAd();
        if (isIndexPage() || isSolverOnlyPage())
            injectLeftSidebarAd();
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
function setMode(mode) {
    localStorage.setItem(ADS_KEY, mode);
    applyMode(mode);
}
function initAdToggle() {
    const btn = document.getElementById("ad-toggle-btn");
    if (!btn)
        return;
    const indicator = document.getElementById("ad-mode-indicator");
    const NEXT_MODE = { full: "minimal", minimal: "hidden", hidden: "full" };
    const NEXT_LABEL = { full: "Minimal Ads", minimal: "Hide Ads", hidden: "Show Ads" };
    const MODE_LABEL = { full: "showing: full", minimal: "showing: minimal", hidden: "showing: none" };
    function updateLabel(mode) {
        btn.setAttribute("aria-pressed", String(mode === "full"));
        btn.textContent = NEXT_LABEL[mode];
        if (indicator)
            indicator.textContent = MODE_LABEL[mode];
    }
    updateLabel(getAdsMode());
    btn.addEventListener("click", () => {
        const next = NEXT_MODE[getAdsMode()];
        setMode(next);
        updateLabel(next);
    });
}
function initAds() {
    initAdToggle();
    function start() {
        setTimeout(() => applyMode(getAdsMode()), 150);
    }
    // Delay until layout is stable and React solvers have mounted
    if (document.readyState === "complete") {
        start();
    }
    else {
        window.addEventListener("load", start);
    }
    // Re-apply if viewport crosses mobile→desktop so sidebars can load
    let wasMobile = isMobileViewport();
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const nowMobile = isMobileViewport();
            if (wasMobile && !nowMobile)
                applyMode(getAdsMode());
            wasMobile = nowMobile;
        }, 200);
    });
}
/** Debug helper (exposed on window.Ads): tints every ad slot red. */
function makeAdsRed() {
    const styleId = "ads-red-override";
    if (document.getElementById(styleId))
        return;
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
