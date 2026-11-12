const { JSDOM } = require("jsdom");
const { prepareTables } = require("./tables.cjs");
const { resolveStepRefs } = require("./step-refs.cjs");
const { preRenderIndexNav } = require("./index-nav.cjs");
const { generateQuickLinks } = require("./quick-links.cjs");
const { formatGuideStats } = require("./guide-stats.cjs");

/**
 * Steps share one JSDOM parse (the slow part) and return whether they changed
 * anything. generateQuickLinks reads the finished page, so it goes last.
 * classifyLinks must run before this pass, or the TOC anchors built here would
 * get .link-to-page. A throwing step is skipped but its partial edit ships.
 */
const DOM_STEPS = [
    ["prepareTables", prepareTables],
    ["resolveStepRefs", resolveStepRefs],
    ["preRenderIndexNav", preRenderIndexNav],
    ["formatGuideStats", formatGuideStats],
    ["generateQuickLinks", generateQuickLinks],
];

// Keep in sync with what the steps look for, or pages skip the parse.
const DOM_PASS_TRIGGERS = [
    "<table",
    'class="stats"',
    "data-step-ref",
    "data-index-nav",
    "content-container",
];

function domPass(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    if (!DOM_PASS_TRIGGERS.some((trigger) => content.includes(trigger))) return content;

    let dom;
    try {
        dom = new JSDOM(content);
    } catch (error) {
        console.error(`Error parsing ${outputPath}:`, error.message);
        return content;
    }

    let touched = false;
    for (const [name, step] of DOM_STEPS) {
        try {
            if (step(dom.window.document, outputPath)) touched = true;
        } catch (error) {
            console.error(`Error in ${name} for ${outputPath}:`, error.message);
        }
    }

    return touched ? dom.serialize() : content;
}

module.exports = { domPass };
