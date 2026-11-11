/**
 * Interactive R2 image workflow: `bun run r2`
 *
 * Images are served from R2 by functions/games/[[path]].js, not the deployment.
 * Upload BEFORE deploying, or new pages 404 on their images.
 * Sync is scoped to one map so its deletes never reach another map or variants/.
 */

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "src", "games");
const BUCKET = "r2:mmmrkennedy-images";
const REMOTE = `${BUCKET}/img`;

// A phone lightbox is ~390 CSS px, ~1170 real px at 3x DPR.
// See docs/r2-migration-part2-responsive-variants.md.
const TIERS = [1280, 1920];

// Gitignored, ~1.5GB, rebuildable from src/.
const CACHE = path.join(REPO, ".variants");

// Each cwebp already uses -mt, so this stays well below core count.
const ENCODE_CONCURRENCY = 4;

// Only the formats functions/games/[[path]].js serves; keeps guide .html out.
const FILTERS = ["--include", "*.webp", "--include", "*.png", "--include", "*.jpg", "--include", "*.jpeg", "--include", "*.gif"];

// The R2 token can't create buckets, so rclone's bucket probe (a CreateBucket
// call) 403s like an auth failure on the first upload of a new map.
const NO_BUCKET_CHECK = ["--s3-no-check-bucket"];

function findRclone() {
    const dir = path.join(REPO, "guide_making_utils", "rclone");
    for (const name of ["rclone.exe", "rclone"]) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const RCLONE = findRclone();

function rclone(args) {
    const res = spawnSync(RCLONE, args, { stdio: "inherit" });
    if (res.error) throw res.error;
    return res.status ?? 1;
}

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

/** Pixel width from the WebP header. 0 for anything unrecognised, which callers skip. */
function webpWidth(file) {
    let fd;
    try {
        fd = fs.openSync(file, "r");
        const b = Buffer.alloc(32);
        fs.readSync(fd, b, 0, 32, 0);
        if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return 0;
        const chunk = b.toString("ascii", 12, 16);
        if (chunk === "VP8 ") return b.readUInt16LE(26) & 0x3fff;
        if (chunk === "VP8L") return (b.readUInt32LE(21) & 0x3fff) + 1;
        if (chunk === "VP8X") return (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
        return 0;
    } catch {
        return 0;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

function walkWebp(root, out = []) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, e.name);
        if (e.isDirectory()) walkWebp(p, out);
        else if (e.name.toLowerCase().endsWith(".webp")) out.push(p);
    }
    return out;
}

/** .webp only: the other images are animated GIFs, which cwebp would flatten to one frame. */
function planVariants(root) {
    const jobs = [];
    let skippedSmall = 0;
    let upToDate = 0;

    for (const src of walkWebp(root)) {
        const width = webpWidth(src);
        if (!width) continue;
        const rel = path.relative(SRC, src);

        for (const tier of TIERS) {
            if (width <= tier) {
                skippedSmall++;
                continue;
            }
            const dest = path.join(CACHE, String(tier), rel);
            if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) {
                upToDate++;
                continue;
            }
            jobs.push({ src, dest, tier });
        }
    }
    return { jobs, skippedSmall, upToDate };
}

function encodeOne({ src, dest, tier }) {
    return new Promise((resolve) => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        // q90 passed by eye at 1280 but not at 2560, so masters stay untouched.
        const args = ["-q", "90", "-m", "6", "-pass", "10", "-mt", "-resize", String(tier), "0", src, "-o", dest];
        const p = spawn("cwebp", args, { stdio: "ignore" });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
    });
}

async function encodeAll(jobs) {
    let done = 0;
    let failed = 0;
    let next = 0;

    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= jobs.length) return;
            const ok = await encodeOne(jobs[i]);
            if (!ok) failed++;
            done++;
            if (done % 25 === 0 || done === jobs.length) {
                stdout.write(`\r  encoding ${done}/${jobs.length}${failed ? `  (${failed} failed)` : ""}   `);
            }
        }
    }

    await Promise.all(Array.from({ length: ENCODE_CONCURRENCY }, worker));
    stdout.write("\n");
    return failed;
}

function dirSize(dir) {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
    return total;
}

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

function fmtSize(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * rclone's dry-run output doesn't distinguish new from changed, and its
 * "update modification time" lines are md5-identical files, not uploads.
 * So parse the -vv JSON log:
 *   debug  "Need to transfer - File not found at Destination"  -> new
 *   notice skipped: "copy"                                     -> new or changed
 *   notice skipped: "update modification time"                 -> timestamp only
 *   notice skipped: "delete"                                   -> deleted (sync only)
 */
function planTransfer(mode, source, remote, extra = []) {
    return new Promise((resolve) => {
        const args = [mode, source, remote, ...FILTERS, ...NO_BUCKET_CHECK, ...extra, "--dry-run", "-vv", "--use-json-log", "--transfers", "8"];
        const p = spawn(RCLONE, args, { stdio: ["ignore", "ignore", "pipe"] });

        const notFound = new Set();
        const plan = { added: [], changed: [], touched: [], deleted: [], errors: [] };
        let checked = 0;

        const lines = createInterface({ input: p.stderr });
        lines.on("line", (line) => {
            let e;
            try {
                e = JSON.parse(line);
            } catch {
                if (line.trim()) plan.errors.push(line);
                return;
            }
            if (e.level === "error" || e.level === "critical") {
                plan.errors.push(e.object ? `${e.object}: ${e.msg}` : e.msg);
                return;
            }
            if (!e.object) return;

            if (e.msg === "Need to transfer - File not found at Destination") notFound.add(e.object);
            else if (e.msg === "Unchanged skipping") checked++;
            else if (e.skipped === "copy") {
                (notFound.has(e.object) ? plan.added : plan.changed).push({ path: e.object, size: e.size });
                checked++;
            } else if (e.skipped === "update modification time") {
                plan.touched.push({ path: e.object, size: e.size });
            } else if (e.skipped === "delete") {
                plan.deleted.push({ path: e.object, size: e.size });
            } else return;

            if (checked % 100 === 0) stdout.write(`\r  checked ${checked} files…   `);
        });

        p.on("error", (err) => resolve({ ...plan, code: 1, errors: [...plan.errors, err.message] }));
        p.on("close", (code) => {
            stdout.write(`\r  checked ${checked} files.        \n`);
            for (const k of ["added", "changed", "touched", "deleted"]) plan[k].sort((a, b) => a.path.localeCompare(b.path));
            resolve({ ...plan, code: code ?? 1 });
        });
    });
}

function printGroup(title, items, prefix, limit = Infinity) {
    if (!items.length) return;
    const total = items.reduce((s, f) => s + f.size, 0);
    console.log(`\n  ${title} (${items.length}, ${fmtSize(total)})`);
    for (const f of items.slice(0, limit)) console.log(`    ${prefix}${f.path}  ${fmtSize(f.size)}`);
    if (items.length > limit) console.log(`    … and ${items.length - limit} more`);
}

function printPlan(plan, prefix) {
    if (plan.code !== 0) {
        for (const err of plan.errors.slice(0, 20)) console.log(`  ${err}`);
        return false;
    }
    printGroup("New", plan.added, prefix);
    printGroup("Changed", plan.changed, prefix);
    printGroup("Timestamp only, content identical (metadata update, no upload)", plan.touched, prefix, 10);
    // Never truncated: every one of these is permanent.
    printGroup("DELETED from R2", plan.deleted, prefix);
    return true;
}

function withListFile(items, fn) {
    const file = path.join(os.tmpdir(), `r2-list-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(file, items.map((f) => f.path).join("\n") + "\n");
    try {
        return fn(file);
    } finally {
        fs.rmSync(file, { force: true });
    }
}

/**
 * Applies exactly the confirmed plan instead of re-running copy/sync, so nothing
 * unlisted changes. Deletes run last so a failed upload never leaves files removed.
 * --files-from-raw takes filenames literally (no comment/whitespace parsing).
 */
function applyPlan(source, remote, plan, extra = []) {
    const uploads = [...plan.added, ...plan.changed, ...plan.touched];
    if (uploads.length) {
        const status = withListFile(uploads, (list) =>
            rclone(["copy", source, remote, "--files-from-raw", list, "--no-traverse", ...NO_BUCKET_CHECK, ...extra, "--progress", "--transfers", "8"]),
        );
        if (status !== 0) {
            console.log("\n  Upload failed.");
            return false;
        }
    }
    if (plan.deleted.length) {
        const status = withListFile(plan.deleted, (list) =>
            rclone(["delete", remote, "--files-from-raw", list, ...NO_BUCKET_CHECK, "--progress"]),
        );
        if (status !== 0) {
            console.log("\n  Delete failed.");
            return false;
        }
    }
    return true;
}

/** Images are gitignored; R2 is the copy of record, so a fresh clone needs this. */
async function doRestore(ask) {
    console.log("\n  Downloads every image from R2 into src/games.");
    console.log("  For a fresh clone, or a machine that has lost its images.");
    console.log("  Only adds and overwrites — never deletes local files.\n");

    if (rclone(["copy", REMOTE, SRC, ...FILTERS, ...NO_BUCKET_CHECK, "--dry-run", "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  rclone failed.");
        return;
    }

    if (!(await confirm(ask, "Download these? (y/N):"))) {
        console.log("  Cancelled.");
        return;
    }

    console.log("");
    if (rclone(["copy", REMOTE, SRC, ...FILTERS, ...NO_BUCKET_CHECK, "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  Download failed.");
        return;
    }
    console.log("\n  Done. `bun run dev` will now show images locally.");
}

async function doVariants(ask) {
    if (spawnSync("cwebp", ["-version"], { stdio: "ignore" }).error) {
        console.log("\n  cwebp not found on PATH. Install Google's libwebp.");
        return;
    }

    console.log("\n  Generates downscaled copies for small screens, at " + TIERS.join("w and ") + "w.");
    console.log("  Masters are untouched; these are extra files under variants/ in the bucket.");

    const scope = (await ask("\n  (a)ll maps or (o)ne map? [a/o]: ")).trim().toLowerCase();
    let mapRel = "";
    if (scope === "o") mapRel = await askMap(ask, "generate variants for");

    await runVariants(ask, mapRel);
}

async function runVariants(ask, mapRel) {
    const root = mapRel ? path.join(SRC, ...mapRel.split("/")) : SRC;

    console.log("\n  Scanning…");
    const { jobs, skippedSmall, upToDate } = planVariants(root);

    console.log(`  to encode      : ${jobs.length}`);
    console.log(`  already cached : ${upToDate}`);
    console.log(`  too small      : ${skippedSmall} (source already <= tier, would upscale)`);

    if (jobs.length) {
        console.log(`\n  Encoding is CPU-heavy. The cache at .variants/ makes re-runs cheap,`);
        console.log(`  and interrupting is safe — finished files are kept.`);
        if (!(await confirm(ask, `Encode ${jobs.length} variants now? (y/N):`))) {
            console.log("  Cancelled.");
            return;
        }
        const failed = await encodeAll(jobs);
        if (failed) console.log(`  ${failed} failed to encode.`);
    } else {
        console.log("\n  Nothing to encode.");
    }

    for (const tier of TIERS) {
        const local = path.join(CACHE, String(tier), mapRel.split("/").join(path.sep));
        if (!fs.existsSync(local)) continue;
        console.log(`\n  ${tier}w cache: ${mb(dirSize(local))}`);
    }

    if (!(await confirm(ask, "\n  Upload variants to R2? (y/N):"))) {
        console.log("  Left in .variants/ — re-run to upload later.");
        return;
    }

    for (const tier of TIERS) {
        const local = path.join(CACHE, String(tier), mapRel.split("/").join(path.sep));
        if (!fs.existsSync(local)) continue;
        const remote = `${BUCKET}/variants/${tier}${mapRel ? "/" + mapRel : ""}`;
        console.log(`\n  ${local}\n  -> ${remote}\n`);
        if (rclone(["copy", local, remote, ...FILTERS, ...NO_BUCKET_CHECK, "--progress", "--transfers", "8"]) !== 0) {
            console.log(`\n  Upload of ${tier}w failed.`);
            return;
        }
    }

    console.log("\n  Done. Bucket now holds:");
    for (const tier of TIERS) rclone(["size", `${BUCKET}/variants/${tier}`, ...NO_BUCKET_CHECK]);
}

class Eof extends Error {}

// rl.question() never settles if the interface closes while pending, so race it against close.
function createAsk(rl) {
    const closed = new Promise((_, reject) => rl.once("close", () => reject(new Eof())));
    closed.catch(() => {});
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

async function confirm(ask, question, defaultYes = false) {
    const a = (await ask(`  ${question} `)).trim().toLowerCase();
    if (!a) return defaultYes;
    return a === "y" || a === "yes";
}

// Defaults to yes: missing variants fail silently, the Function just serves full-size masters.
async function offerVariants(ask, mapRel) {
    if (spawnSync("cwebp", ["-version"], { stdio: "ignore" }).error) return;
    const where = mapRel || "every map";
    if (!(await confirm(ask, `\n  Generate + upload size variants for ${where} now? (Y/n):`, true))) {
        console.log("  Skipped. Those images will serve full-size until you run option 3.");
        return;
    }
    await runVariants(ask, mapRel);
}

async function doUpload(ask) {
    const scope = (await ask("\n  Upload (a)ll maps or (o)ne map? [a/o]: ")).trim().toLowerCase();

    let source = SRC;
    let remote = REMOTE;
    let mapForVariants = "";
    if (scope === "o") {
        const map = await askMap(ask, "upload");
        mapForVariants = map;
        source = path.join(SRC, ...map.split("/"));
        remote = toRemote(map);
    }

    console.log(`\n  source : ${source}\n  remote : ${remote}\n  Comparing against R2 — nothing is sent yet.\n`);
    const plan = await planTransfer("copy", source, remote);
    if (!printPlan(plan, scope === "o" ? `${mapForVariants}/` : "")) {
        console.log("\n  rclone failed. Nothing uploaded.");
        return;
    }

    const uploads = plan.added.length + plan.changed.length;
    if (!uploads && !plan.touched.length) {
        console.log("\n  Everything is already up to date.");
        return;
    }

    const question = uploads
        ? `\n  Upload ${uploads} file${uploads === 1 ? "" : "s"}${plan.touched.length ? ` and fix ${plan.touched.length} timestamps` : ""}? (y/N):`
        : `\n  Nothing to upload. Fix ${plan.touched.length} timestamps? (y/N):`;
    if (!(await confirm(ask, question))) {
        console.log("  Cancelled.");
        return;
    }

    console.log("");
    if (!applyPlan(source, remote, plan)) return;

    console.log("\n  Bucket now holds:");
    rclone(["size", remote, ...NO_BUCKET_CHECK]);
    console.log("\n  Replacements go live immediately — no purge needed. Cache-Control: no-cache");
    console.log("  stops the edge serving a stored copy without checking R2 first.");

    await offerVariants(ask, scope === "o" ? mapForVariants : "");
}

async function doSync(ask) {
    console.log("\n  Sync makes the bucket match one map exactly, DELETING objects whose local");
    console.log("  files are gone. Use it after re-shooting a map. There is no undo.");

    const map = await askMap(ask, "sync");
    const source = path.join(SRC, ...map.split("/"));
    const remote = toRemote(map);

    const useChecksum = await confirm(ask, "Compare by checksum instead of size+time? (slower, catches same-size re-encodes) (y/N):");

    const extra = useChecksum ? ["--checksum"] : [];

    console.log(`\n  map    : ${map}\n  remote : ${remote}\n  Comparing against R2 — nothing is changed yet.\n`);
    const plan = await planTransfer("sync", source, remote, extra);
    if (!printPlan(plan, `${map}/`)) {
        console.log("\n  rclone failed. Nothing changed.");
        return;
    }

    const uploads = plan.added.length + plan.changed.length;
    if (!uploads && !plan.touched.length && !plan.deleted.length) {
        console.log("\n  Bucket already matches this map.");
        return;
    }

    const parts = [];
    if (uploads) parts.push(`upload ${uploads}`);
    if (plan.touched.length) parts.push(`fix ${plan.touched.length} timestamps`);
    if (plan.deleted.length) parts.push(`DELETE ${plan.deleted.length}`);
    const summary = parts.join(", ");

    if (plan.deleted.length) {
        const typed = (await ask(`\n  ${summary}. This DELETES. Type the map name to confirm (${map}): `)).trim();
        if (typed !== map) {
            console.log("  Did not match. Cancelled.");
            return;
        }
    } else if (!(await confirm(ask, `\n  Nothing to delete. ${summary[0].toUpperCase()}${summary.slice(1)}? (y/N):`))) {
        console.log("  Cancelled.");
        return;
    }

    console.log("");
    // Pass --checksum through, or size+time skips the same-size re-encodes the dry run flagged.
    if (!applyPlan(source, remote, plan, extra)) return;

    console.log("\n  Bucket now holds:");
    rclone(["size", remote, ...NO_BUCKET_CHECK]);
    console.log("\n  Replacements go live immediately — no purge needed.");

    await offerVariants(ask, map);
}

function showHelp() {
    console.log(`
  Guide images live in an R2 bucket, not in the deployment and not in git.
  functions/games/[[path]].js serves them at the URLs the guides already use.

  The bucket has two prefixes:
    img/          one file per image in src/games — the full-size original
    variants/     downscaled copies at ${TIERS.join("w and ")}w, for small screens

  ---------------------------------------------------------------------------
  (1) Upload new/changed images
      Sends anything new or modified from src/games to img/. Never deletes.
      Use after ADDING screenshots. Offers to build variants afterwards.

  (2) Sync one map
      Makes the bucket match one map exactly — uploads changes AND DELETES
      objects whose local file is gone. Use after RE-SHOOTING or renaming,
      where option 1 would leave the old files behind answering at their old
      URLs. Deletes for real: dry run first, and you must type the map name.

  (3) Size variants
      Encodes ${TIERS.join("w and ")}w copies with cwebp and uploads them.
      Skips anything already smaller than a tier, and anything unchanged since
      last time (cached in .variants/). Slow on a full run, cheap after.
      Options 1 and 2 offer this automatically, so you rarely need it here.

  (4) Restore images from R2
      Downloads every image into src/games. For a fresh clone, which has none
      because images are gitignored. Only adds — never deletes local files.

  (5) Bucket size
      How much of the 10GB free tier is used.

  ---------------------------------------------------------------------------
  Typical: add screenshots -> (1) -> say yes to variants -> commit -> push.
  Re-shot a map: (2) -> say yes to variants.

  Upload BEFORE deploying. A page that goes live referencing an image the
  bucket does not have yet will 404 until it is uploaded.
`);
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
            const choice = (await ask(
                "\n  (1) Upload new/changed images   (2) Sync one map (deletes)" +
                    "\n  (3) Size variants               (4) Restore images from R2" +
                    "\n  (5) Bucket size                 (6) Help" +
                    "\n  (7) Quit" +
                    "\n  > ",
            )).trim().toLowerCase();

            if (choice === "1") return void (await doUpload(ask));
            if (choice === "2") return void (await doSync(ask));
            if (choice === "3") return void (await doVariants(ask));
            if (choice === "4") return void (await doRestore(ask));
            if (choice === "5") {
                console.log("\n  img/ (full-size, served when no ?w=)");
                rclone(["size", REMOTE, ...NO_BUCKET_CHECK]);
                for (const tier of TIERS) {
                    console.log(`  variants/${tier}/`);
                    rclone(["size", `${BUCKET}/variants/${tier}`, ...NO_BUCKET_CHECK]);
                }
                console.log("\n  Free tier is 10 GB.");
                continue;
            }
            if (choice === "6" || choice === "h" || choice === "help") {
                showHelp();
                continue;
            }
            if (choice === "7" || choice === "q") return;
        }
    } catch (err) {
        if (!(err instanceof Eof)) throw err;
        console.log("");
    } finally {
        rl.close();
    }
}

await main();
