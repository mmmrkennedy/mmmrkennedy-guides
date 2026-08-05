/**
 * Interactive R2 image workflow.
 *
 *   bun run r2       (or: npm run r2)
 *
 * Guide screenshots live in an R2 bucket and are served by
 * functions/games/[[path]].js, not from the deployment. That means uploading is
 * a separate step from deploying, and it has to happen FIRST — HTML that goes
 * live referencing an image R2 does not have yet will 404 until it is uploaded.
 *
 * Two operations, kept apart because one of them deletes:
 *
 *   Upload (rclone copy) — only adds and overwrites, never removes. The
 *   everyday action after adding screenshots to a map.
 *
 *   Sync (rclone sync)   — makes the bucket match the source exactly, which
 *   means deleting objects whose local files are gone. Needed after re-shooting
 *   a map, because copy leaves renamed and removed screenshots behind, still
 *   answering at their old URLs. Scoped to one map so the blast radius is one
 *   map — never another, and never the originals/ prefix holding PNG masters.
 *
 * Both always dry-run first and ask before doing anything.
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "src", "games");
const BUCKET = "r2:mmmrkennedy-images";
const REMOTE = `${BUCKET}/img`;
const ORIGINALS = `${BUCKET}/originals`;

// Only the formats functions/games/[[path]].js serves. Without these the guide
// .html files sitting in the same tree would be uploaded too.
const FILTERS = ["--include", "*.webp", "--include", "*.png", "--include", "*.jpg", "--include", "*.jpeg", "--include", "*.gif"];

function findRclone() {
    const dir = path.join(REPO, "guide_making_utils", "rclone");
    for (const name of ["rclone.exe", "rclone"]) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const RCLONE = findRclone();

/** Run rclone with its output going straight to the terminal, so the progress
 *  meter animates instead of arriving in one lump at the end. */
function rclone(args) {
    const res = spawnSync(RCLONE, args, { stdio: "inherit" });
    if (res.error) throw res.error;
    return res.status ?? 1;
}

/** "BO7/astra_malorum" for every map folder that actually holds images. */
function listMaps() {
    const maps = [];
    for (const game of fs.readdirSync(SRC, { withFileTypes: true })) {
        if (!game.isDirectory()) continue;
        const gameDir = path.join(SRC, game.name);
        for (const entry of fs.readdirSync(gameDir, { withFileTypes: true })) {
            if (entry.isDirectory()) maps.push(`${game.name}/${entry.name}`);
        }
    }
    return maps.sort();
}

function toRemote(mapPath) {
    return `${REMOTE}/${mapPath.split(path.sep).join("/")}`;
}

/** Thrown when stdin ends (Ctrl+D, or piped input running out). */
class Eof extends Error {}

/**
 * rl.question() never settles if the interface closes while it is pending, which
 * leaves the process hanging on an unsettled await. Race every prompt against
 * close so end-of-input becomes an ordinary "quit" instead.
 */
function createAsk(rl) {
    const closed = new Promise((_, reject) => rl.once("close", () => reject(new Eof())));
    closed.catch(() => {}); // never an unhandled rejection if we exit another way
    return (q) => Promise.race([rl.question(q), closed]);
}

async function askMap(ask, purpose) {
    const maps = listMaps();
    console.log(`\n  Which map? (blank to list all, e.g. BO_CW/die_maschine)`);
    for (;;) {
        const answer = (await ask(`  Map to ${purpose}: `)).trim().replace(/[\\/]+$/, "");
        if (!answer) {
            console.log("");
            for (const m of maps) console.log(`    ${m}`);
            continue;
        }
        const normalised = answer.split(/[\\/]/).join("/");
        const dir = path.join(SRC, ...normalised.split("/"));
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return normalised;

        const near = maps.filter((m) => m.toLowerCase().includes(normalised.toLowerCase()));
        console.log(`  No such map: ${normalised}`);
        if (near.length) console.log(`  Did you mean: ${near.slice(0, 5).join(", ")}`);
    }
}

async function confirm(ask, question) {
    const a = (await ask(`  ${question} `)).trim().toLowerCase();
    return a === "y" || a === "yes";
}

async function doUpload(ask) {
    const scope = (await ask("\n  Upload (a)ll maps or (o)ne map? [a/o]: ")).trim().toLowerCase();

    let source = SRC;
    let remote = REMOTE;
    if (scope === "o") {
        const map = await askMap(ask, "upload");
        source = path.join(SRC, ...map.split("/"));
        remote = toRemote(map);
    }

    console.log(`\n  source : ${source}\n  remote : ${remote}\n  Dry run first — nothing is sent yet.\n`);
    if (rclone(["copy", source, remote, ...FILTERS, "--dry-run", "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  rclone failed. Nothing uploaded.");
        return;
    }

    if (!(await confirm(ask, "Upload these? (y/N):"))) {
        console.log("  Cancelled.");
        return;
    }

    console.log("");
    if (rclone(["copy", source, remote, ...FILTERS, "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  Upload failed.");
        return;
    }

    console.log("\n  Bucket now holds:");
    rclone(["size", remote]);
    console.log("\n  If you replaced an existing image, its URL has not changed, so the edge");
    console.log("  cache will still be serving the old one. Purge those URLs before checking.");
}

async function doSync(ask) {
    console.log("\n  Sync makes the bucket match one map exactly, DELETING objects whose local");
    console.log("  files are gone. Use it after re-shooting a map. There is no undo.");

    const map = await askMap(ask, "sync");
    const source = path.join(SRC, ...map.split("/"));
    const remote = toRemote(map);

    const useChecksum = await confirm(ask, "Compare by checksum instead of size+time? (slower, catches same-size re-encodes) (y/N):");

    const args = ["sync", source, remote, ...FILTERS, "--progress", "--transfers", "8"];
    if (useChecksum) args.push("--checksum");

    console.log(`\n  map    : ${map}\n  remote : ${remote}\n  Dry run first — read every 'Deleted' line below.\n`);
    if (rclone([...args, "--dry-run"]) !== 0) {
        console.log("\n  rclone failed. Nothing changed.");
        return;
    }

    // Deliberate friction: typing the map name is harder to do by reflex than y.
    const typed = (await ask(`\n  This DELETES. Type the map name to confirm (${map}): `)).trim();
    if (typed !== map) {
        console.log("  Did not match. Cancelled.");
        return;
    }

    console.log("");
    if (rclone(args) !== 0) {
        console.log("\n  Sync failed.");
        return;
    }

    console.log("\n  Bucket now holds:");
    rclone(["size", remote]);
    console.log("\n  Replaced images keep their URLs, so purge this map's image URLs before");
    console.log("  checking the live site.");
}

async function main() {
    if (!RCLONE) {
        console.error(`\n  rclone not found in ${path.join(REPO, "guide_making_utils", "rclone")}`);
        console.error("  Download it from rclone.org and unzip it there.");
        process.exitCode = 1;
        return;
    }
    if (!fs.existsSync(SRC)) {
        console.error(`\n  Not found: ${SRC}`);
        process.exitCode = 1;
        return;
    }

    const rl = createInterface({ input: stdin, output: stdout });
    const ask = createAsk(rl);

    try {
        for (;;) {
            const choice = (await ask("\n  (1) Upload new/changed  (2) Sync one map  (3) Bucket size  (4) Quit: ")).trim();
            if (choice === "1") return void (await doUpload(ask));
            if (choice === "2") return void (await doSync(ask));
            if (choice === "3") {
                console.log("");
                console.log("  img/ (served to readers)");
                rclone(["size", REMOTE]);
                console.log("  originals/ (PNG masters, never served)");
                rclone(["size", ORIGINALS]);
                continue;
            }
            if (choice === "4" || choice.toLowerCase() === "q") return;
        }
    } catch (err) {
        // Ctrl+D or end of piped input — an ordinary way to leave, not a fault.
        if (!(err instanceof Eof)) throw err;
        console.log("");
    } finally {
        rl.close();
    }
}

await main();
