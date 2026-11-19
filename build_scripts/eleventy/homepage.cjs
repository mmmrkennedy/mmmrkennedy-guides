const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const INDEX = path.join(__dirname, "..", "..", "src", "index.html");

let cached = null;

/**
 * src/index.html, the site registry. stats.cjs, solver-index.cjs, relatedMaps.js and
 * unfinishedPages.js all read it every build, so it is parsed once and reused until
 * the file changes. Shared: callers must not modify the document.
 */
function homepageDoc() {
    const { mtimeMs } = fs.statSync(INDEX);
    if (cached?.mtimeMs !== mtimeMs) {
        cached = { mtimeMs, doc: new JSDOM(fs.readFileSync(INDEX, "utf8")).window.document };
    }
    return cached.doc;
}

module.exports = { homepageDoc };
