const { JSDOM } = require("jsdom");
const { prepareTables } = require("./tables.cjs");
const { resolveStepRefs } = require("./step-refs.cjs");
const { preRenderIndexNav } = require("./index-nav.cjs");
const { generateQuickLinks } = require("./quick-links.cjs");

/**
 * The DOM-rewriting steps, sharing one JSDOM parse because parsing is the slow
 * part of the build.
 *
 * A step takes the document and returns whether it changed anything. A page is
 * re-serialized only if one did, so untouched pages come out byte-identical.
 * generateQuickLinks reads the finished page, so it goes last.
 *
 * classifyLinks runs before this pass: the tables of contents built here are full
 * of anchors it must not touch (they would pick up .link-to-page and go italic).
 *
 * A step that throws is logged and skipped, and any partial edit it made ships.
 */
const DOM_STEPS = [
    ["prepareTables", prepareTables],
    ["resolveStepRefs", resolveStepRefs],
    ["preRenderIndexNav", preRenderIndexNav],
    ["generateQuickLinks", generateQuickLinks],
];

// If a page contains none of these, no step has anything to do, so skip the parse.
const DOM_PASS_TRIGGERS = [
    "<table",
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
