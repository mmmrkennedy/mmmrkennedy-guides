/**
 * Ad management: inline ads (every other content-container) + right sidebar ad
 * Toggle persisted in localStorage under key 'ads-mode'
 * Modes: "full" (default), "minimal" (sidebars only), "hidden"
 *
 * Injection happens once per type; body classes control visibility thereafter.
 */

const ADS_KEY = "ads-mode";
const MOBILE_MAX_WIDTH = 768;
const injected = { sidebars: false, inline: false };

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

function buildInFeedAdHTML() {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-format="fluid"
     data-ad-layout-key="-gv-1+13-42+5j"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="2538910337"></ins>`;
}

function buildSidebarAdHTML() {
    return `<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-2164582284838563"
     data-ad-slot="5840873517"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>`;
}

function pushAd(container) {
    try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
        console.warn("AdSense push failed:", e);
    }
}

const AD_INTERVAL_PX_FULL = 2000;
const AD_INTERVAL_PX_MINIMAL = 3600;

function insertInlineAdSlot(afterContainer, contentPxBefore) {
    const wrapper = document.createElement("div");
    wrapper.className = "ad-inline";
    wrapper.style.display = "none";
    wrapper.dataset.contentPxBefore = String(contentPxBefore);
    wrapper.innerHTML = buildInlineAdHTML();
    afterContainer.after(wrapper);
}

function injectInlineAdSlots() {
    if (isSolverOnlyPage()) return;

    const containers = Array.from(
        document.querySelectorAll(".content-window .content-container")
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

function applyInlineInterval(intervalPx) {
    const slots = document.querySelectorAll(".content-window .ad-inline");
    let lastShownPx = 0;
    slots.forEach((slot) => {
        const px = Number(slot.dataset.contentPxBefore || "0");
        if (px - lastShownPx >= intervalPx) {
            slot.style.display = "";
            if (!slot.dataset.pushed) {
                pushAd(slot);
                slot.dataset.pushed = "1";
            }
            lastShownPx = px;
        } else {
            slot.style.display = "none";
        }
    });
}

function isSolverOnlyPage() {
    return document.querySelector(".solver-only-page") !== null;
}

function injectMultiplexAd() {
    if (isSolverOnlyPage()) return;

    const els = document.querySelectorAll(".content-window .content-container, .content-window .ad-inline");
    if (els.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ad-multiplex";
    wrapper.innerHTML = buildMultiplexAdHTML();
    els[els.length - 1].after(wrapper);
    pushAd(wrapper);
}

function isIndexPage() {
    const path = window.location.pathname;
    return path === "/" || path === "/index.html";
}

function injectInFeedAds() {
    const container = document.querySelector(".content-window .content-container");
    if (!container) return;

    const lists = Array.from(container.querySelectorAll(":scope > ul"));
    if (lists.length === 0) return;

    lists.forEach((ul, i) => {
        if ((i + 1) % 3 === 0 && i < lists.length - 1) {
            const wrapper = document.createElement("div");
            wrapper.className = "ad-infeed";
            wrapper.innerHTML = buildInFeedAdHTML();
            ul.after(wrapper);
            pushAd(wrapper);
        }
    });
}

function injectSidebarAd() {
    const existing = document.querySelector(".ad-right-sidebar");
    if (existing) return;

    const wrapper = document.createElement("div");
    wrapper.className = "ad-right-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    pushAd(wrapper);
    positionSidebarAd(wrapper);
}

function getSidebarGap() {
    return isSolverOnlyPage() ? 80 : 40;
}

function getContentBounds() {
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

function positionSidebarAd(adEl) {
    function update() {
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
    }
    update();
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}

function injectLeftSidebarAd() {
    const existing = document.querySelector(".ad-left-sidebar");
    if (existing) return;
    const wrapper = document.createElement("div");
    wrapper.className = "ad-left-sidebar";
    wrapper.innerHTML = buildSidebarAdHTML();
    document.body.appendChild(wrapper);
    pushAd(wrapper);
    positionLeftSidebarAd(wrapper);
}

function positionLeftSidebarAd(adEl) {
    function update() {
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
    }
    update();
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(update, 100); });
}

function applyMode(mode) {
    document.body.classList.remove("ads-full", "ads-minimal", "ads-hidden");
    document.body.classList.add(`ads-${mode}`);

    const needSidebars = mode !== "hidden" && !isMobileViewport();
    const needInline = mode !== "hidden";

    if (needSidebars && !injected.sidebars) {
        injectSidebarAd();
        if (isIndexPage() || isSolverOnlyPage()) injectLeftSidebarAd();
        injected.sidebars = true;
    }

    if (needInline && !injected.inline) {
        if (!isIndexPage()) {
            injectInlineAdSlots();
        }
        injectMultiplexAd();
        // if (isIndexPage()) injectInFeedAds();
        injected.inline = true;
    }

    if (needInline && !isIndexPage() && !isSolverOnlyPage()) {
        const intervalPx = mode === "minimal" ? AD_INTERVAL_PX_MINIMAL : AD_INTERVAL_PX_FULL;
        applyInlineInterval(intervalPx);
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
    if (!btn) return;

    const indicator = document.getElementById("ad-mode-indicator");
    const NEXT_MODE = { full: "minimal", minimal: "hidden", hidden: "full" };
    const NEXT_LABEL = { full: "Minimal Ads", minimal: "Hide Ads", hidden: "Show Ads" };
    const MODE_LABEL = { full: "showing: full", minimal: "showing: minimal", hidden: "showing: none" };

    function updateLabel(mode) {
        btn.setAttribute("aria-pressed", String(mode === "full"));
        btn.textContent = NEXT_LABEL[mode];
        if (indicator) indicator.textContent = MODE_LABEL[mode];
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
    } else {
        window.addEventListener("load", start);
    }

    // Re-apply if viewport crosses mobile→desktop so sidebars can load
    let wasMobile = isMobileViewport();
    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const nowMobile = isMobileViewport();
            if (wasMobile && !nowMobile) applyMode(getAdsMode());
            wasMobile = nowMobile;
        }, 200);
    });
}

function makeAdsRed() {
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

// document.addEventListener("DOMContentLoaded", () => {
//     makeAdsRed()
// })

window.Ads = { initAds, makeAdsRed };
