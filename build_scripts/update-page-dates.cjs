#!/usr/bin/env node
/**
 * Run by the pre-commit hook when a commit touches .html. Writes:
 *   lastmod-cache.json    newest commit per page (rebuilt from git log)
 *   editcount-cache.json  commits per page (rebuilt from git log)
 *   release-dates.json    first-live day per guide
 *
 * Release dates can't be rebuilt (older ones came from a previous repo), so they
 * are only added to. To undo an accidental release, delete its line by hand.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function git(args) {
    return execSync(`git -c core.quotepath=false ${args}`, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
    }).trim();
}

const lines = (output) => output.split("\n").filter(Boolean);

function writeJson(file, map) {
    const sorted = {};
    for (const key of Object.keys(map).sort()) sorted[key] = map[key];
    fs.writeFileSync(path.join(__dirname, file), JSON.stringify(sorted, null, 2) + "\n");
}

// A shallow clone would undercount edits and misdate pages.
if (git("rev-parse --is-shallow-repository") === "true") {
    console.error("update-page-dates: needs full git history, but this clone is shallow.");
    process.exit(1);
}

// ISO-8601 with local offset, matching git log's %cI.
function nowIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
    );
}

// Newest first, so a file's first sighting is its newest date.
const newest = {};
const counts = {};
let commitDate = null;
for (const line of lines(git("log --format=%cI --name-only --diff-filter=ACMRT"))) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
        commitDate = line;
    } else {
        newest[line] ??= commitDate;
        counts[line] = (counts[line] || 0) + 1;
    }
}

const pages = new Set(lines(git('ls-files -- "*.html"')));
const staged = new Set(lines(git('diff --cached --name-only --diff-filter=ACMR -- "*.html"')));
const now = nowIso();
const lastmod = {};
const editcount = {};
for (const page of pages) {
    if (!staged.has(page) && !newest[page]) continue;
    lastmod[page] = staged.has(page) ? now : newest[page];
    editcount[page] = (counts[page] || 0) + (staged.has(page) ? 1 : 0);
}
writeJson("lastmod-cache.json", lastmod);
writeJson("editcount-cache.json", editcount);

const releases = JSON.parse(fs.readFileSync(path.join(__dirname, "release-dates.json"), "utf8"));
const index = git("show :src/index.html").replace(/<!--[\s\S]*?-->/g, " ");
const today = now.slice(0, 10);
const released = [];
for (const [, attrs] of index.matchAll(/<a\b([^>]*)>/gi)) {
    const href = attrs.match(/href\s*=\s*["']\/?(games\/[^"'?#]+)/i)?.[1];
    if (!href || /class\s*=\s*["'][^"']*\bdisabled\b/i.test(attrs)) continue;
    const page = `src/${href.replace(/\.html$/, "")}.html`;
    if (pages.has(page) && !releases[page]) {
        releases[page] = today;
        released.push(page);
    }
}
if (released.length) {
    writeJson("release-dates.json", releases);
    console.log(`update-page-dates: released ${released.join(", ")}`);
}
