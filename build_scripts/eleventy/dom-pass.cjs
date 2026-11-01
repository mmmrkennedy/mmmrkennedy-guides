const { JSDOM } = require("jsdom");
const { prepareTables } = require("./tables.cjs");
const { resolveStepRefs } = require("./step-refs.cjs");
const { preRenderIndexNav } = require("./index-nav.cjs");
const { generateQuickLinks } = require("./quick-links.cjs");

/**
 * The DOM-rewriting half of the build, run as a single pass.
 *
 * Each step below used to be its own Eleventy transform, which meant a page was
 * parsed into a JSDOM document and serialized back out up to five times over.
 * Eleventy's own benchmark put those five at 77% of build time, and most of the
 * parses bought nothing: prepareTables parsed all 82 pages to serve 33.
 * One parse, one serialize, same steps in the same order.
 *
 * A step takes the shared document and returns whether it changed anything. The
 * page is re-serialized only if some step did, so pages no step touches (the
 * index, /stats, 404) come out byte-identical to their input instead of being
 * round-tripped through JSDOM's serializer.
 *
 * Order is load-bearing:
 *   - generateQuickLinks reads the finished page, so it goes last.
 *
 * classifyLinks deliberately runs BEFORE this pass rather than inside it. It is
 * a regex over the HTML string, and the two tables of contents this pass builds
 * are full of anchors it must not touch (they would pick up .link-to-page and
 * render italic). Running it first means those anchors do not exist yet, which
 * is what the 40-line cutElement() surgery used to arrange by hand.
 *
 * A step that throws is logged and skipped; the rest of the pass still runs, so
 * one bad page loses one feature rather than the whole build. Note the step may
 * have mutated the document before throwing, and that partial edit does ship —
 * the alternative is discarding four good steps to undo half of a fifth.
 */
const DOM_STEPS = [
    ["prepareTables", prepareTables],
    ["resolveStepRefs", resolveStepRefs],
    ["preRenderIndexNav", preRenderIndexNav],
    ["generateQuickLinks", generateQuickLinks],
];

// Cheap string tests standing in for the selectors the steps run. If a page
// matches none of them, parsing it could only ever find nothing to do.
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
