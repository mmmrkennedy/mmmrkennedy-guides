const fs = require("fs");
const path = require("path");

// Also covers video, audio and a few root-level static files.
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

async function shouldCopy({ src, dest }) {
    let destStat;
    try {
        destStat = await fs.promises.stat(dest);
    } catch {
        return true;
    }
    return (await fs.promises.stat(src)).mtimeMs > destStat.mtimeMs;
}

// Concurrent because per-file latency is the bottleneck: one stat at a time took
// ~0.95s per rebuild over ~5000 images on Windows, ~0.3s this way.
const CONCURRENCY = 32;
async function eachConcurrently(items, fn) {
    let next = 0;
    async function worker() {
        while (next < items.length) await fn(items[next++]);
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
}

// Images live in R2 and are served by functions/games/[[path]].js, so a production
// build (IMAGES_FROM_R2=true) leaves them out, while local dev still copies them.
// Video and audio aren't in R2, so they stay in the deployment.
const R2_SERVED = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

async function smartCopyImages() {
    const skipImages = process.env.IMAGES_FROM_R2 === "true";

    const pairs = [
        ...walkDir("src/games")
            .filter((src) => !(skipImages && R2_SERVED.has(path.extname(src).toLowerCase())))
            .map((src) => ({
                src,
                dest: path.join("dist", path.relative("src", src)),
            })),
        // Root-level assets are never skipped: crawlers fetch og_image.png and the
        // favicon by absolute URL, outside the images Function.
        ...fs.readdirSync("src", { withFileTypes: true })
            .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
            .map((e) => ({ src: path.join("src", e.name), dest: path.join("dist", e.name) })),
    ];

    // Create the directories up front so the concurrent copies never race on mkdir.
    const todo = [];
    await eachConcurrently(pairs, async (pair) => {
        if (await shouldCopy(pair)) todo.push(pair);
    });
    const skipped = pairs.length - todo.length;
    for (const dir of new Set(todo.map(({ dest }) => path.dirname(dest)))) {
        fs.mkdirSync(dir, { recursive: true });
    }

    await eachConcurrently(todo, ({ src, dest }) => fs.promises.copyFile(src, dest));

    console.log(`[smartCopyImages] ${todo.length} copied, ${skipped} skipped (unchanged)`);
}

module.exports = { smartCopyImages };
