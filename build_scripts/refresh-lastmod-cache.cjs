#!/usr/bin/env node
/**
 * refresh-lastmod-cache.cjs
 *
 * Run by GitHub Actions (with full git history) to update lastmod-cache.json.
 * Does NOT build the sitemap — that happens on Cloudflare CI using the cache.
 *
 * Usage: node build_scripts/refresh-lastmod-cache.cjs
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const LASTMOD_CACHE = path.resolve(__dirname, "lastmod-cache.json");

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

function getGitLastModified() {
    const output = git(
        "-c core.quotepath=false log --format=%cI --name-only --diff-filter=ACMRT"
    ).trim();

    const map = {};
    let currentDate = null;
    for (const line of output.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
            currentDate = trimmed;
        } else if (currentDate) {
            const normalized = trimmed.replace(/\\/g, "/");
            if (!(normalized in map)) map[normalized] = currentDate;
        }
    }
    return map;
}

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(LASTMOD_CACHE, "utf8"));
    } catch {
        return {};
    }
}

function writeCache(map) {
    const sorted = {};
    for (const k of Object.keys(map).sort()) sorted[k] = map[k];
    fs.writeFileSync(LASTMOD_CACHE, JSON.stringify(sorted, null, 2) + "\n");
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
const freshMap = getGitLastModified();

if (Object.keys(freshMap).length === 0) {
    console.error("No file dates found in git log. Aborting.");
    process.exit(1);
}

const existing = readCache();
const merged = { ...existing, ...freshMap };
writeCache(merged);

console.log(
    `lastmod-cache.json updated with ${Object.keys(merged).length} entries (${Object.keys(freshMap).length} from git).`
);
