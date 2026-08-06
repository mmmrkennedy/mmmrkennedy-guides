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
 *   map — never another map, and never the variants/ prefix.
 *
 * Both always dry-run first and ask before doing anything.
 */

import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(REPO, "src", "games");
const BUCKET = "r2:mmmrkennedy-images";
const REMOTE = `${BUCKET}/img`;

// Downscaled copies for small screens. A phone renders the lightbox about 390
// CSS px wide, so at 3x DPR it needs ~1170 real pixels — not the 2560 of the
// master, and certainly not the 5MB some masters weigh. See
// docs/r2-migration-part2-responsive-variants.md.
const TIERS = [1280, 1920];

// Encoded variants are cached here between runs so a second run only touches
// what changed. Gitignored: it is derived data, rebuildable from src/ at any
// time, and roughly 1.5GB.
const CACHE = path.join(REPO, ".variants");

// How many cwebp processes at once. Each already uses -mt internally, so this
// is deliberately well below core count.
const ENCODE_CONCURRENCY = 4;

// Only the formats functions/games/[[path]].js serves. Without these the guide
// .html files sitting in the same tree would be uploaded too.
const FILTERS = ["--include", "*.webp", "--include", "*.png", "--include", "*.jpg", "--include", "*.jpeg", "--include", "*.gif"];

// The R2 API token is scoped to Object Read & Write, which cannot create
// buckets. Without this rclone probes for the bucket first and that probe is a
// CreateBucket call — denied with a 403 that reads like an auth failure. It only
// surfaces on a prefix rclone has not seen, i.e. the first upload of a new map.
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

/**
 * Pixel width from a WebP header, without decoding the image or shelling out.
 * RIFF container: "RIFF"<len>"WEBP"<chunk>, then the chunk carries the size.
 * Returns 0 for anything unrecognised, which callers treat as "leave it alone".
 */
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

/** Every .webp under `root`, recursively. */
function walkWebp(root, out = []) {
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        const p = path.join(root, e.name);
        if (e.isDirectory()) walkWebp(p, out);
        else if (e.name.toLowerCase().endsWith(".webp")) out.push(p);
    }
    return out;
}

/**
 * What needs encoding, and what does not.
 *
 * Skipped, deliberately:
 *   - anything already at or below the tier width, because upscaling a
 *     128x128 sprite to 1280 would make it bigger AND worse;
 *   - .webp only — the nine other images under src/games are animated GIFs
 *     (calling cards, director's cut clips) and cwebp would flatten them to a
 *     single frame;
 *   - sources not newer than an already-cached variant, so a re-run costs
 *     nothing for images that have not changed.
 */
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
        // Same settings the samples were judged on: q90 was accepted by eye at
        // 1280 and rejected at full 2560, which is why only downscaled copies
        // are lossy and the masters stay as they are.
        const args = ["-q", "90", "-m", "6", "-pass", "10", "-mt", "-resize", String(tier), "0", src, "-o", dest];
        const p = spawn("cwebp", args, { stdio: "ignore" });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
    });
}

/** Bounded-concurrency encode with a single-line progress counter. */
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

/**
 * Pull every image down from R2 into src/games.
 *
 * Images are gitignored, so a fresh clone has none and every guide renders with
 * broken pictures until this runs. R2 is the copy of record for them; this is
 * how a new machine — or a recovered one — gets a working tree.
 *
 * `copy` in this direction only adds and overwrites: it will not delete local
 * files, so running it on a working tree that is ahead of the bucket cannot
 * lose anything.
 */
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

/**
 * The variant flow for a known scope. Split out from the menu entry so uploading
 * or syncing a map can offer it straight afterwards — new images with no
 * variants do not break anything (the Function falls back to the master), they
 * just quietly serve full-size to everyone, which is the failure this avoids.
 */
async function runVariants(ask, mapRel) {
    const root = mapRel ? path.join(SRC, ...mapRel.split("/")) : SRC;

    console.log("\n  Scanning…");
    const { jobs, skippedSmall, upToDate } = planVariants(root);

    console.log(`  to encode      : ${jobs.length}`);
    console.log(`  already cached : ${upToDate}`);
    console.log(`  too small      : ${skippedSmall} (source already <= tier, would upscale)`);

    if (jobs.length) {
        // -pass 10 is slow by design; on a full run this is minutes, not seconds.
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

async function confirm(ask, question, defaultYes = false) {
    const a = (await ask(`  ${question} `)).trim().toLowerCase();
    if (!a) return defaultYes;
    return a === "y" || a === "yes";
}

/**
 * Offered after an upload or sync, because "changed some images" and "their
 * variants are stale" are the same event. Defaults to yes: forgetting is
 * silent — the Function falls back to the master, so the only symptom is every
 * visitor getting full-size images.
 */
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

    console.log(`\n  source : ${source}\n  remote : ${remote}\n  Dry run first — nothing is sent yet.\n`);
    if (rclone(["copy", source, remote, ...FILTERS, ...NO_BUCKET_CHECK, "--dry-run", "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  rclone failed. Nothing uploaded.");
        return;
    }

    if (!(await confirm(ask, "Upload these? (y/N):"))) {
        console.log("  Cancelled.");
        return;
    }

    console.log("");
    if (rclone(["copy", source, remote, ...FILTERS, ...NO_BUCKET_CHECK, "--progress", "--transfers", "8"]) !== 0) {
        console.log("\n  Upload failed.");
        return;
    }

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

    const args = ["sync", source, remote, ...FILTERS, ...NO_BUCKET_CHECK, "--progress", "--transfers", "8"];
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
    rclone(["size", remote, ...NO_BUCKET_CHECK]);
    console.log("\n  Replacements go live immediately — no purge needed.");

    // Sync is the "I re-shot this map" action, so its variants are certainly
    // stale — this is the pairing that matters most.
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
        // Ctrl+D or end of piped input — an ordinary way to leave, not a fault.
        if (!(err instanceof Eof)) throw err;
        console.log("");
    } finally {
        rl.close();
    }
}

await main();
