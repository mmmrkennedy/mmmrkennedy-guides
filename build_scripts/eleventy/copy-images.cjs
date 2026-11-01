const fs = require("fs");
const path = require("path");

// Extensions eligible for the smart asset copy below (not strictly images, also
// includes video, audio, and a few root-level static files).
const IMAGE_EXTENSIONS = new Set([
    ".webp", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".webm", ".ico", ".xml", ".txt",
    ".flac", ".mp3", ".ogg", ".wav", ".m4a",
]);

function walkDir(dir, results = []) {
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkDir(fullPath, results);
        } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            results.push(fullPath);
        }
    }
    return results;
}

function shouldCopy(src, dest) {
    if (!fs.existsSync(dest)) return true;
    return fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
}

// Images live in R2 and are served by functions/games/[[path]].js, so a
// production build has no reason to carry 4,555 of them into the deployment.
// Opt-in via IMAGES_FROM_R2=true (set alongside BUNDLE=true in `bun run build`)
// rather than on by default, so `eleventy --serve` keeps copying them and local
// dev works from disk with no bucket, no binding and no network.
//
// Only the image formats actually uploaded are skipped. The handful of .webm
// and .wav files under src/games stay in the deployment — 19MB total, and
// keeping them out of R2 keeps the Function's route check purely image-based.
const R2_SERVED = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

async function smartCopyImages() {
    const skipImages = process.env.IMAGES_FROM_R2 === "true";

    const pairs = [
        // src/games/**/* → dist/games/**/
        ...walkDir("src/games")
            .filter((src) => !(skipImages && R2_SERVED.has(path.extname(src).toLowerCase())))
            .map((src) => ({
                src,
                dest: path.join("dist", path.relative("src", src)),
            })),
        // src root-level assets → dist/. Never skipped: og_image.png and the
        // favicon are referenced by absolute URL in meta tags and by crawlers
        // that will not be going through the images Function.
        ...fs.readdirSync("src", { withFileTypes: true })
            .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
            .map((e) => ({ src: path.join("src", e.name), dest: path.join("dist", e.name) })),
    ];

    // Decide what actually needs copying (mtime check), then pre-create the unique
    // destination directories once so the concurrent copies below never race on mkdir.
    const todo = pairs.filter(({ src, dest }) => shouldCopy(src, dest));
    const skipped = pairs.length - todo.length;
    for (const dir of new Set(todo.map(({ dest }) => path.dirname(dest)))) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Copy concurrently. The bottleneck on a clean build (e.g. Cloudflare, which
    // starts from an empty dist every deploy) is per-file syscall latency across
    // thousands of images, not raw throughput, so a worker pool hides that latency
    // and cuts a cold copy from ~100s to a fraction of that.
    const CONCURRENCY = 32;
    let next = 0;
    async function worker() {
        while (next < todo.length) {
            const { src, dest } = todo[next++];
            await fs.promises.copyFile(src, dest);
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    console.log(`[smartCopyImages] ${todo.length} copied, ${skipped} skipped (unchanged)`);
}

module.exports = { smartCopyImages };
