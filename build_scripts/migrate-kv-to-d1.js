#!/usr/bin/env node
// One-time backfill: copy existing per-page view counts from Workers KV into D1.
//
// Reads every `views:<path>` key from the KV namespace and emits an idempotent
// SQL file of upserts, then (optionally) applies it to D1. Run this ONCE during
// the KV→D1 cutover. A few views logged between this snapshot and the moment the
// D1-backed views.js goes live will be lost — acceptable for a vanity counter.
//
// Prereqs: `wrangler` available (npx works), logged in, and wrangler.toml has
// the VIEWS KV binding id and the D1 database filled in. See
// docs/feedback-runbook.md.
//
// Usage:
//   node build_scripts/migrate-kv-to-d1.js                 # write SQL only, print next step
//   node build_scripts/migrate-kv-to-d1.js --execute       # write SQL and apply to remote D1
//   node build_scripts/migrate-kv-to-d1.js --binding VIEWS --database guides-feedback
//   node build_scripts/migrate-kv-to-d1.js --local         # use local KV/D1 instead of remote

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function opt(name, fallback) {
    const i = args.indexOf("--" + name);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}
const BINDING = opt("binding", "VIEWS");
const DATABASE = opt("database", "guides-feedback");
const PREFIX = opt("prefix", "views:");
const REMOTE = args.includes("--local") ? "--local" : "--remote";
const EXECUTE = args.includes("--execute");
const OUT = path.join("migrations_data", "views_backfill.sql");

const wrangler = (subArgs) =>
    execFileSync("npx", ["--yes", "wrangler", ...subArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function sqlEscape(s) {
    return String(s).replace(/'/g, "''");
}

console.log(`Listing KV keys (binding=${BINDING}, prefix="${PREFIX}", ${REMOTE})…`);
let keys;
try {
    const raw = wrangler(["kv", "key", "list", "--binding", BINDING, "--prefix", PREFIX, REMOTE]);
    keys = JSON.parse(raw);
} catch {
    console.error("Failed to list KV keys. Is wrangler configured and the VIEWS binding filled in wrangler.toml?");
    process.exit(1);
}

if (!Array.isArray(keys) || keys.length === 0) {
    console.log("No KV keys found — nothing to backfill.");
    process.exit(0);
}

const rows = [];
for (const k of keys) {
    const name = k.name;
    if (!name || !name.startsWith(PREFIX)) continue;
    const p = name.slice(PREFIX.length);
    let value;
    try {
        value = wrangler(["kv", "key", "get", name, "--binding", BINDING, REMOTE]).trim();
    } catch {
        console.warn(`  ! could not read ${name} — skipping`);
        continue;
    }
    const count = parseInt(value, 10);
    if (!Number.isFinite(count) || count < 0) {
        console.warn(`  ! ${name} = "${value}" is not a count — skipping`);
        continue;
    }
    rows.push(`INSERT INTO views (path, count) VALUES ('${sqlEscape(p)}', ${count}) ` +
        `ON CONFLICT(path) DO UPDATE SET count = excluded.count;`);
}

if (rows.length === 0) {
    console.log("No valid view counts found — nothing to write.");
    process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, rows.join("\n") + "\n", "utf8");
console.log(`Wrote ${rows.length} upserts → ${OUT}`);

const execCmd = ["d1", "execute", DATABASE, "--file", OUT, REMOTE];
if (EXECUTE) {
    console.log(`Applying to D1 (${DATABASE}, ${REMOTE})…`);
    wrangler(execCmd);
    console.log("Backfill applied. Verify with: npx wrangler d1 execute " +
        `${DATABASE} ${REMOTE} --command "SELECT COUNT(*) AS pages, SUM(count) AS views FROM views"`);
} else {
    console.log("\nNext step — apply it with:\n  npx wrangler " + execCmd.join(" "));
}
