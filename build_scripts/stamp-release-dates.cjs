#!/usr/bin/env node
/**
 * stamp-release-dates.cjs
 *
 * Keeps release-dates.json current as guides ship, so the footer's "Initial
 * release" date doesn't need a manual rebuild.
 *
 * Run from the pre-commit hook whenever src/index.html is staged. It compares
 * the staged index against HEAD's and records today's date for any guide whose
 * link just became enabled: the same signal derive-release-dates.cjs recovered
 * from history, applied one commit at a time.
 *
 * Rules:
 *   - a date already on file is never overwritten; "initial release" happens once
 *   - a guide that goes back to disabled within GRACE_DAYS of its stamp has that
 *     stamp removed (that's an accidental release being pulled, not a launch);
 *     past the window the date stands, because pulling a long-published guide
 *     doesn't unmake its release
 *   - nothing else in the file is touched, so the dates recovered from the old
 *     zombiesGuides repo, unreproducible on any other machine, stay put
 *
 * Usage:
 *   node build_scripts/stamp-release-dates.cjs          # staged vs HEAD (the hook)
 *   node build_scripts/stamp-release-dates.cjs --worktree  # working copy vs HEAD
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { toKey, nameHintsFrom, enabledKeys } = require("./index-links.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = "src/index.html";
const CACHE_PATH = path.join(REPO_ROOT, "build_scripts/release-dates.json");

// How long a just-stamped guide can be pulled back before the stamp is treated
// as a real release rather than a slip.
const GRACE_DAYS = 14;

const useWorktree = process.argv.includes("--worktree");

function git(args) {
    return execSync(`git ${args}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });
}

/** File content at a git revision, or null if it isn't there. */
function showFile(rev) {
    try {
        return git(`show ${rev}:${INDEX_PATH}`);
    } catch {
        return null;
    }
}

/** Today as a bare local calendar date, matching the cache's "YYYY-MM-DD". */
function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysSince(iso) {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    const now = new Date();
    const then = Date.UTC(y, m - 1, d);
    const nowUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((nowUtc - then) / 86400000);
}

/**
 * key -> repo-relative file path, for every guide page that exists now. Built
 * from the index (tracked files) plus anything staged, so a guide added and
 * enabled in the same commit still resolves.
 */
function guidePathsByKey() {
    const files = new Set();
    for (const list of [
        git('-c core.quotepath=false ls-files -- "src/games/**/*.html"'),
        git('-c core.quotepath=false diff --cached --name-only --diff-filter=ACMR -- "src/games/**/*.html"'),
    ]) {
        for (const line of list.trim().split("\n")) {
            const f = line.trim().replace(/\\/g, "/");
            if (f) files.add(f);
        }
    }

    const byKey = new Map();
    for (const f of files) {
        const key = toKey(f);
        if (key) byKey.set(key, f);
    }
    return byKey;
}

// ------------------------------------------------------------------------ run

const afterHtml = useWorktree
    ? fs.readFileSync(path.join(REPO_ROOT, INDEX_PATH), "utf8")
    : showFile("");  // "" -> `git show :path`, the staged copy

if (afterHtml === null) {
    console.error(`stamp-release-dates: ${INDEX_PATH} is not tracked; nothing to do.`);
    process.exit(0);
}

const beforeHtml = showFile("HEAD");
if (beforeHtml === null) {
    console.error(`stamp-release-dates: no ${INDEX_PATH} at HEAD; skipping.`);
    process.exit(0);
}

// Names come from the newer snapshot: it's the one whose hrefs we're judging.
const nameHints = nameHintsFrom(afterHtml);
const before = enabledKeys(beforeHtml, nameHints);
const after = enabledKeys(afterHtml, nameHints);

let cache = {};
try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
} catch {
    console.error("stamp-release-dates: release-dates.json missing or unreadable; aborting.");
    process.exit(1);
}

const paths = guidePathsByKey();
const stamp = today();
const added = [];
const removed = [];

for (const key of after) {
    if (before.has(key)) continue; // already live before this commit
    const file = paths.get(key);
    if (!file) {
        console.warn(`stamp-release-dates: ${key} went live but has no guide file; skipped.`);
        continue;
    }
    if (cache[file]) continue; // released once already; that date is the initial one
    cache[file] = stamp;
    added.push(`${file} -> ${stamp}`);
}

for (const key of before) {
    if (after.has(key)) continue; // still live
    const file = paths.get(key);
    if (!file || !cache[file]) continue;
    if (daysSince(cache[file]) > GRACE_DAYS) continue; // a real un-publish, not a slip
    removed.push(`${file} (was ${cache[file]})`);
    delete cache[file];
}

if (added.length === 0 && removed.length === 0) {
    console.log("stamp-release-dates: no guide went live or was pulled; cache unchanged.");
    process.exit(0);
}

const sorted = {};
for (const k of Object.keys(cache).sort()) sorted[k] = cache[k];
fs.writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + "\n");

for (const line of added) console.log(`stamp-release-dates: released ${line}`);
for (const line of removed) console.log(`stamp-release-dates: un-stamped ${line} (pulled within ${GRACE_DAYS} days)`);
