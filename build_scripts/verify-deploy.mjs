#!/usr/bin/env node
/**
 * verify-deploy.mjs
 *
 * Post-deploy check: fetch the live site and confirm every CSS/JS/font asset
 * the pages reference actually comes back as that asset.
 *
 * Why this exists. Cloudflare Pages answers a request for a file it can't find
 * by serving index.html at status *200*, not 404. `_headers` gives /*.js and
 * /*.css `max-age=2592000`, so if such a request lands during deploy
 * propagation the edge caches a copy of the homepage under the asset's URL for
 * 30 days. The browser then pulls HTML where it asked for a script; with
 * `X-Content-Type-Options: nosniff` set, Firefox refuses it and reports
 * NS_ERROR_CORRUPTED_CONTENT, and every bit of JS on the site stops running.
 * Content-addressed filenames don't help — the poisoned response is a 200.
 *
 * That happened on 2026-07-31 to /js/bundle.core.c945556e.min.js and would
 * have persisted for a month. Running this after each deploy turns a silent
 * 30-day outage into an immediate, loud failure.
 *
 * The page list comes from the deployed sitemap.xml, and asset URLs from the
 * live HTML — deliberately not from ./dist, which drifts the moment a dev
 * watcher rebuilds it unbundled.
 *
 * Usage:
 *   node build_scripts/verify-deploy.mjs [origin] [--pages N] [--quiet]
 *
 * Exits 1 if any asset is served wrong, so it can gate a deploy script.
 */

const DEFAULT_ORIGIN = "https://mmmrkennedy.com";

// Content types we'll accept per extension. Cloudflare appends "; charset=..."
// to some of these, so these are matched as prefixes.
const EXPECTED = {
    ".js": ["application/javascript", "text/javascript"],
    ".mjs": ["application/javascript", "text/javascript"],
    ".css": ["text/css"],
    ".woff2": ["font/woff2", "application/font-woff2"],
};

function parseArgs(argv) {
    const args = { origin: DEFAULT_ORIGIN, pages: Infinity, quiet: false };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--quiet") args.quiet = true;
        else if (arg === "--pages") args.pages = Number(argv[++i]);
        else if (arg.startsWith("--pages=")) args.pages = Number(arg.split("=")[1]);
        else if (!arg.startsWith("--")) args.origin = arg.replace(/\/$/, "");
    }

    if (!Number.isFinite(args.pages) && args.pages !== Infinity) {
        console.error("--pages needs a number");
        process.exit(2);
    }

    return args;
}

async function getText(url, init) {
    const res = await fetch(url, { redirect: "follow", ...init });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
}

/** Page URLs from the deployed sitemap, always including the homepage. */
async function collectPages(origin, limit) {
    const urls = new Set([`${origin}/`]);

    try {
        const xml = await getText(`${origin}/sitemap.xml`);
        for (const [, loc] of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
            urls.add(loc.trim());
        }
    } catch (error) {
        console.warn(`Could not read sitemap.xml (${error.message}) — checking the homepage only.`);
    }

    return [...urls].slice(0, limit);
}

/** Every same-origin css/js/font URL referenced by the given pages. */
async function collectAssets(pages, origin) {
    const assets = new Map(); // url -> Set of pages referencing it
    const pageProblems = [];

    for (const page of pages) {
        let html;
        try {
            html = await getText(page);
        } catch (error) {
            pageProblems.push({ page, reason: error.message });
            continue;
        }

        for (const [, ref] of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs|css|woff2))(?:\?[^"']*)?["']/g)) {
            if (/^https?:\/\//i.test(ref) && !ref.startsWith(origin)) continue; // third-party
            const url = new URL(ref, page).toString();
            if (!url.startsWith(origin)) continue;
            // Cloudflare injects its own challenge/insights scripts under this
            // prefix. They aren't ours to deploy or purge.
            if (new URL(url).pathname.startsWith("/cdn-cgi/")) continue;
            if (!assets.has(url)) assets.set(url, new Set());
            assets.get(url).add(page);
        }
    }

    return { assets, pageProblems };
}

function extensionOf(url) {
    const match = new URL(url).pathname.match(/\.[a-z0-9]+$/i);
    return match ? match[0].toLowerCase() : "";
}

function contentTypeOk(ext, contentType) {
    const allowed = EXPECTED[ext];
    if (!allowed) return true; // unknown extension — nothing to assert
    const actual = contentType.split(";")[0].trim().toLowerCase();
    return allowed.includes(actual);
}

/**
 * Checks one asset. When the plain request looks wrong, retries with a
 * cache-busting query: a different cache key reaches past the edge entry, so a
 * pass on the retry means the origin is fine and only the cache is poisoned —
 * which is the difference between "purge this URL" and "your deploy is broken".
 */
async function checkAsset(url) {
    const ext = extensionOf(url);

    let res;
    try {
        res = await fetch(url, { redirect: "follow" });
    } catch (error) {
        return { url, ok: false, kind: "unreachable", detail: error.message };
    }

    const contentType = res.headers.get("content-type") || "";
    const cacheStatus = res.headers.get("cf-cache-status") || "-";
    const size = (await res.arrayBuffer()).byteLength;

    if (res.ok && contentTypeOk(ext, contentType)) {
        return { url, ok: true, contentType, size, cacheStatus };
    }

    let originOk = false;
    let originDetail = "";
    try {
        const bust = new URL(url);
        bust.searchParams.set("__verify", Date.now().toString(36));
        const retry = await fetch(bust, { redirect: "follow", cache: "no-store" });
        const retryType = retry.headers.get("content-type") || "";
        originOk = retry.ok && contentTypeOk(ext, retryType);
        originDetail = `${retry.status} ${retryType.split(";")[0]}`;
    } catch (error) {
        originDetail = error.message;
    }

    return {
        url,
        ok: false,
        kind: originOk ? "poisoned-cache" : "missing-at-origin",
        status: res.status,
        contentType,
        size,
        cacheStatus,
        originDetail,
    };
}

async function main() {
    const { origin, pages: pageLimit, quiet } = parseArgs(process.argv.slice(2));

    console.log(`Verifying deploy at ${origin}`);

    const pages = await collectPages(origin, pageLimit);
    console.log(`  ${pages.length} page(s) from sitemap`);

    const { assets, pageProblems } = await collectAssets(pages, origin);
    console.log(`  ${assets.size} unique asset(s) referenced\n`);

    if (assets.size === 0) {
        console.error("No assets found — the pages did not parse as expected. Not treating this as a pass.");
        process.exit(2);
    }

    const results = await Promise.all([...assets.keys()].map(checkAsset));
    results.sort((a, b) => a.url.localeCompare(b.url));

    for (const r of results) {
        const path = new URL(r.url).pathname;
        if (r.ok) {
            if (!quiet) {
                console.log(`  ok    ${path.padEnd(44)} ${r.contentType.split(";")[0].padEnd(24)} ${r.size} b  [${r.cacheStatus}]`);
            }
        } else {
            const got = r.kind === "unreachable" ? r.detail : `${r.status} ${r.contentType.split(";")[0]}`;
            console.log(`  FAIL  ${path.padEnd(44)} ${got}`);
        }
    }

    const failures = results.filter((r) => !r.ok);

    for (const { page, reason } of pageProblems) {
        console.log(`  FAIL  ${page} (page did not load: ${reason})`);
    }

    if (failures.length === 0 && pageProblems.length === 0) {
        console.log(`\nAll ${results.length} assets served correctly.`);
        return;
    }

    const poisoned = failures.filter((r) => r.kind === "poisoned-cache");
    const missing = failures.filter((r) => r.kind !== "poisoned-cache");

    if (poisoned.length > 0) {
        console.log(`\n${poisoned.length} asset(s) served as the wrong type by the edge, but correct at the origin.`);
        console.log("This is a cached Pages fallback. Purge these URLs (Cloudflare dashboard ->");
        console.log("Caching -> Configuration -> Purge Cache -> Custom Purge):\n");
        for (const r of poisoned) console.log(`  ${r.url}`);
    }

    if (missing.length > 0) {
        console.log(`\n${missing.length} asset(s) are wrong at the origin too — the deploy itself is incomplete:\n`);
        for (const r of missing) console.log(`  ${r.url}  (${r.kind}; retry gave ${r.originDetail})`);
        console.log("\nRebuild with `npm run build` and redeploy. Do not deploy a dist/ that a");
        console.log("dev watcher has rebuilt — it is unbundled and references different files.");
    }

    process.exit(1);
}

main().catch((error) => {
    console.error(`verify-deploy failed: ${error.stack || error.message}`);
    process.exit(2);
});
