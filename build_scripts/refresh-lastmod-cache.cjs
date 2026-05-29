#!/usr/bin/env node
/**
 * refresh-lastmod-cache.cjs
 *
 * Run by GitHub Actions (with full git history) to update lastmod-cache.json
 * and editcount-cache.json (commits-per-file, used for the footer edit count).
 * Does NOT build the sitemap — that happens on Cloudflare CI using the cache.
 *
 * Usage: node build_scripts/refresh-lastmod-cache.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const LASTMOD_CACHE = path.resolve(__dirname, "lastmod-cache.json");
const EDITCOUNT_CACHE = path.resolve(__dirname, "editcount-cache.json");

function git(args) {
    return execSync(`git ${args}`, {
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });
}

function isGitRepo() {
    try {
        return git("rev-parse --is-inside-work-tree").trim() === "true";
    } catch {
        return false;
    }
}

function isShallow() {
    try {
        return git("rev-parse --is-shallow-repository").trim() === "true";
    } catch {
        return false;
    }
}

// Single pass over the full history gives us both the newest commit date per
// file (for lastmod) and the number of commits that touched it (for edit count).
function getGitHistory() {
    const output = git(
        "-c core.quotepath=false log --format=%cI --name-only --diff-filter=ACMRT"
    ).trim();

    const dates = {};
    const counts = {};
    let currentDate = null;
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
            currentDate = trimmed;
        } else if (currentDate) {
            const normalized = trimmed.replace(/\\/g, "/");
            // Log is newest-first, so the first sighting is the newest date.
            if (!(normalized in dates)) dates[normalized] = currentDate;
            // Every appearance is one commit that touched this file.
            counts[normalized] = (counts[normalized] || 0) + 1;
        }
    }
    return { dates, counts };
}

// Currently-tracked .html files. We only build sitemap entries for these, so
// the cache shouldn't track anything else (no webp/css/js/png) and shouldn't
// retain paths that have since been renamed or deleted.
function getTrackedHtmlFiles() {
    const output = git('-c core.quotepath=false ls-files -- "*.html"').trim();
    if (!output) return [];
    return output.split("\n").map((line) => line.trim().replace(/\\/g, "/"));
}

// .html files staged in the index (Added/Copied/Modified/Renamed). When run
// from a pre-commit hook these aren't in `git log` yet, so we date them "now"
// instead of leaving them a commit behind. Empty when run post-commit (e.g.
// the GitHub Action), so that path stays a pure git-log rebuild.
function getStagedHtmlFiles() {
    try {
        const output = git(
            '-c core.quotepath=false diff --cached --name-only --diff-filter=ACMR -- "*.html"'
        ).trim();
        if (!output) return [];
        return output.split("\n").map((line) => line.trim().replace(/\\/g, "/"));
    } catch {
        return [];
    }
}

// ISO-8601 with local offset, matching the `git log %cI` format already in use.
function nowIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const offMin = -d.getTimezoneOffset();
    const sign = offMin >= 0 ? "+" : "-";
    const oh = pad(Math.floor(Math.abs(offMin) / 60));
    const om = pad(Math.abs(offMin) % 60);
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
    );
}

function writeCache(map) {
    const sorted = {};
    for (const k of Object.keys(map).sort()) sorted[k] = map[k];
    fs.writeFileSync(LASTMOD_CACHE, JSON.stringify(sorted, null, 2) + "\n");
}

function writeEditCounts(map) {
    const sorted = {};
    for (const k of Object.keys(map).sort()) sorted[k] = map[k];
    fs.writeFileSync(EDITCOUNT_CACHE, JSON.stringify(sorted, null, 2) + "\n");
}

if (!isGitRepo()) {
    console.error("Not inside a git repository. Aborting.");
    process.exit(1);
}

if (isShallow()) {
    console.error(
        "Shallow clone detected. Run with fetch-depth: 0 in your GitHub Actions checkout step."
    );
    process.exit(1);
}

console.log("Reading full git history...");
const { dates, counts } = getGitHistory();

if (Object.keys(dates).length === 0) {
    console.error("No file dates found in git log. Aborting.");
    process.exit(1);
}

const htmlFiles = getTrackedHtmlFiles();

if (htmlFiles.length === 0) {
    console.error("No tracked .html files found. Aborting.");
    process.exit(1);
}

// Rebuild from scratch (no merge) so renamed/deleted paths are pruned.
const staged = new Set(getStagedHtmlFiles());
const now = nowIso();
const cache = {};
const editCounts = {};
let missing = 0;
for (const file of htmlFiles) {
    const logCount = counts[file] || 0;
    if (staged.has(file)) {
        cache[file] = now; // about to be committed — not in git log yet
        editCounts[file] = logCount + 1; // the pending commit is one more edit
    } else if (file in dates) {
        cache[file] = dates[file];
        editCounts[file] = logCount;
    } else {
        missing++;
    }
}

writeCache(cache);
writeEditCounts(editCounts);

console.log(
    `lastmod-cache.json rebuilt with ${Object.keys(cache).length} HTML entries.`
);
console.log(
    `editcount-cache.json rebuilt with ${Object.keys(editCounts).length} HTML entries.`
);
if (missing > 0) {
    console.warn(`${missing} tracked .html files had no git log date and were skipped.`);
}
