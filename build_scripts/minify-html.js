import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isMainThread } from "worker_threads";
import { runPool, serveJobs } from "./worker-pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const OPTIONS = {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: true,
    minifyCSS: true,
    minifyJS: true,
    decodeEntities: true,
};

function minifyJsonLd(html) {
    return html.replace(
        /(<script[^>]+type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/gi,
        (_, open, json, close) => {
            try {
                return open + JSON.stringify(JSON.parse(json)) + close;
            } catch {
                return _;
            }
        }
    );
}

function findHtmlFiles(dir) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findHtmlFiles(full).forEach(f => files.push(f));
        else if (entry.isFile() && entry.name.endsWith(".html")) files.push(full);
    }
    return files;
}

async function minifyPage(minify, file) {
    const input = fs.readFileSync(file, "utf8");
    const output = minifyJsonLd(await minify(input, OPTIONS));
    fs.writeFileSync(file, output, "utf8");
    return { before: input.length, after: output.length };
}

// minify() is async but CPU-bound, so Promise.all alone ran one page at a time.
if (isMainThread) {
    const files = findHtmlFiles(distDir);
    const sizes = await runPool(new URL(import.meta.url), files);
    const totalBefore = sizes.reduce((n, s) => n + s.before, 0);
    const totalAfter = sizes.reduce((n, s) => n + s.after, 0);

    const saved = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`Minified ${files.length} files — ${(totalBefore / 1024).toFixed(0)}KB → ${(totalAfter / 1024).toFixed(0)}KB (${saved}% saved)`);
} else {
    // Loaded only here: the main thread never minifies.
    const loaded = import("html-minifier-terser");
    serveJobs(async () => {
        const { minify } = await loaded;
        return (file) => minifyPage(minify, file);
    });
}
