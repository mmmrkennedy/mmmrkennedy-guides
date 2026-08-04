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
 * Self-healing. When CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are set, a
 * failure triggers a purge of the offending URLs followed by a re-check, so the
 * usual outcome is fixed-and-reported rather than a dashboard errand. Purging
 * is also the only *reliable* way to tell a poisoned cache from a broken
 * deploy — see checkAsset below for why the cache-busting probe cannot.
 *
 * Usage:
 *   node build_scripts/verify-deploy.mjs [origin] [--pages N] [--quiet] [--no-purge]
 *
 * Env (optional, enables the purge):
 *   CLOUDFLARE_API_TOKEN   scoped token with Zone -> Cache Purge
 *   CLOUDFLARE_ZONE_ID     zone containing the origin below
 *
 * Exits 1 if any asset is still served wrong after that, so it can gate a
 * deploy script. A failure that the purge repaired exits 0 — the deploy is
 * correct — but says loudly that it happened.
 */

const DEFAULT_ORIGIN = "https://mmmrkennedy.com";

// Cloudflare caps a single purge_cache call at 30 files.
const PURGE_BATCH_SIZE = 30;

// A purge is normally live in a second or two, but it is not instantaneous and
// it is not simultaneous across nodes. Re-check a few times before believing it.
const RECHECK_ATTEMPTS = 5;
const RECHECK_DELAY_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bad command line, as opposed to a bad deploy — worth a different exit code so
 * a CI step can tell "you called this wrong" from "the site is broken".
 */
class UsageError extends Error {}

// Content types we'll accept per extension. Cloudflare appends "; charset=..."
// to some of these, so these are matched as prefixes.
const EXPECTED = {
    ".js": ["application/javascript", "text/javascript"],
    ".mjs": ["application/javascript", "text/javascript"],
    ".css": ["text/css"],
    ".woff2": ["font/woff2", "application/font-woff2"],
};

function parseArgs(argv) {
    const args = { origin: DEFAULT_ORIGIN, pages: Infinity, quiet: false, purge: true };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--quiet") args.quiet = true;
        else if (arg === "--no-purge") args.purge = false;
        else if (arg === "--pages") args.pages = Number(argv[++i]);
        else if (arg.startsWith("--pages=")) args.pages = Number(arg.split("=")[1]);
        else if (!arg.startsWith("--")) args.origin = arg.replace(/\/$/, "");
    }

    if (!Number.isFinite(args.pages) && args.pages !== Infinity) {
        throw new UsageError("--pages needs a number");
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
 * cache-busting query in the hope of reaching past the edge entry.
 *
 * Treat that verdict as a hint, not a finding. On 2026-08-04 this probe
 * reported /js/bundle.core.c60b0549.min.js as `missing-at-origin` — and a
 * cache purge fixed it with no redeploy, which means the origin had the file
 * all along and the probe never left the edge. Cloudflare does not necessarily
 * key a static asset's cache entry on the query string, so `?__verify=` can be
 * served the very entry it is trying to bypass.
 *
 * The authoritative test is purge-then-recheck (see purgeAndRecheck), which is
 * why a failure is worth purging whichever way this lands.
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

/** Credentials for the purge, or null with the reason it is unavailable. */
function purgeCredentials() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const zoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!token && !zoneId) return { creds: null, why: "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID are not set" };
    if (!token) return { creds: null, why: "CLOUDFLARE_API_TOKEN is not set" };
    if (!zoneId) return { creds: null, why: "CLOUDFLARE_ZONE_ID is not set" };
    return { creds: { token, zoneId }, why: "" };
}

/**
 * Purges specific URLs from the edge. Never purges the whole zone: the fix is
 * to evict a handful of poisoned entries, and dumping the entire cache to do it
 * would send every asset on the site back to the origin for no reason.
 */
async function purgeUrls(urls, { token, zoneId }) {
    const batches = [];
    for (let i = 0; i < urls.length; i += PURGE_BATCH_SIZE) {
        batches.push(urls.slice(i, i + PURGE_BATCH_SIZE));
    }

    for (const [index, files] of batches.entries()) {
        const label = batches.length > 1 ? ` (batch ${index + 1}/${batches.length})` : "";
        let res;
        try {
            res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ files }),
            });
        } catch (error) {
            // Never echo the request itself — it carries the token.
            throw new Error(`purge request failed${label}: ${error.message}`);
        }

        let body = {};
        try {
            body = await res.json();
        } catch {
            /* non-JSON error page; status below carries the signal */
        }

        if (!res.ok || body.success === false) {
            const detail = (body.errors || []).map((e) => `${e.code} ${e.message}`).join("; ");
            const hint =
                res.status === 403
                    ? " — the token needs the Zone -> Cache Purge permission on this zone"
                    : "";
            throw new Error(`purge rejected${label}: ${res.status}${detail ? ` (${detail})` : ""}${hint}`);
        }

        console.log(`  purged ${files.length} URL(s)${label}`);
    }
}

/**
 * Purges the failed URLs and re-checks them until they come good or the
 * attempts run out. Returns the ones still broken — those are a genuinely
 * incomplete deploy, since no cache entry survives a purge.
 */
async function purgeAndRecheck(failures, creds) {
    const urls = failures.map((r) => r.url);

    console.log(`\nPurging ${urls.length} URL(s) from the edge…`);
    await purgeUrls(urls, creds);

    let pending = urls;
    const healed = [];

    for (let attempt = 1; attempt <= RECHECK_ATTEMPTS && pending.length > 0; attempt++) {
        await sleep(RECHECK_DELAY_MS);
        const results = await Promise.all(pending.map(checkAsset));
        const stillBad = [];
        for (const r of results) {
            if (r.ok) healed.push(r);
            else stillBad.push(r.url);
        }
        console.log(
            `  re-check ${attempt}/${RECHECK_ATTEMPTS}: ${healed.length} recovered, ${stillBad.length} outstanding`,
        );
        pending = stillBad;
    }

    return { healed, stillBroken: pending };
}

/**
 * Returns the exit code rather than calling process.exit(). process.exit() tears
 * the process down without waiting for a pipe to drain, so under CI — where
 * stdout is a pipe, not a terminal — the report gets truncated, and on Windows
 * the runtime aborts with 0xC0000409 instead of the code we asked for. A gate
 * that reports 3221226505 for a routine failure is worse than useless.
 */
async function main() {
    const { origin, pages: pageLimit, quiet, purge: purgeWanted } = parseArgs(process.argv.slice(2));

    console.log(`Verifying deploy at ${origin}`);

    const pages = await collectPages(origin, pageLimit);
    console.log(`  ${pages.length} page(s) from sitemap`);

    const { assets, pageProblems } = await collectAssets(pages, origin);
    console.log(`  ${assets.size} unique asset(s) referenced\n`);

    if (assets.size === 0) {
        console.error("No assets found — the pages did not parse as expected. Not treating this as a pass.");
        return 2;
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

    const unreachable = failures.filter((r) => r.kind === "unreachable");
    const purgeable = failures.filter((r) => r.kind !== "unreachable");
    const { creds, why } = purgeCredentials();

    // A DNS/TLS failure is not something a purge can answer, and page-load
    // problems mean the check itself never got off the ground.
    const canPurge = purgeWanted && creds && purgeable.length > 0;

    if (!canPurge) {
        console.log(`\n${failures.length} asset(s) served wrong.\n`);
        for (const r of failures) console.log(`  ${r.url}  (${r.kind})`);

        if (purgeable.length > 0) {
            const reason = !purgeWanted ? "--no-purge was passed" : why;
            console.log(`\nNot purging automatically: ${reason}.`);
            console.log("Purge these URLs by hand (Cloudflare dashboard -> Caching -> Configuration");
            console.log("-> Purge Cache -> Custom Purge), or set the two env vars and re-run:\n");
            console.log("  CLOUDFLARE_API_TOKEN   scoped token with Zone -> Cache Purge");
            console.log("  CLOUDFLARE_ZONE_ID     the zone id for this site");
        }
        return 1;
    }

    let healed = [];
    let stillBroken = [];
    try {
        ({ healed, stillBroken } = await purgeAndRecheck(purgeable, creds));
    } catch (error) {
        console.error(`\n${error.message}`);
        console.error("Purge these URLs by hand instead:\n");
        for (const r of purgeable) console.error(`  ${r.url}`);
        return 1;
    }

    if (healed.length > 0) {
        console.log(`\n${healed.length} asset(s) were poisoned edge entries and are now serving correctly:\n`);
        for (const r of healed) console.log(`  ok  ${new URL(r.url).pathname}  ${r.contentType.split(";")[0]}`);
        console.log("\nThe deploy itself was fine — the edge had cached a Pages fallback under");
        console.log("these URLs. Purged and confirmed; no redeploy needed.");
    }

    if (stillBroken.length === 0 && unreachable.length === 0 && pageProblems.length === 0) {
        return 0;
    }

    if (stillBroken.length > 0) {
        console.log(`\n${stillBroken.length} asset(s) are still wrong after a purge — the deploy is incomplete:\n`);
        for (const url of stillBroken) console.log(`  ${url}`);
        console.log("\nNothing cached survives a purge, so these are genuinely absent from the");
        console.log("deployment. Rebuild with `npm run build` and redeploy. Do not deploy a dist/");
        console.log("that a dev watcher has rebuilt — it is unbundled and references different files.");
    }

    if (unreachable.length > 0) {
        console.log(`\n${unreachable.length} asset(s) could not be fetched at all:\n`);
        for (const r of unreachable) console.log(`  ${r.url}  (${r.detail})`);
    }

    return 1;
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error) => {
        if (error instanceof UsageError) {
            console.error(error.message);
            process.exitCode = 2;
            return;
        }
        console.error(`verify-deploy failed: ${error.stack || error.message}`);
        process.exitCode = 2;
    });
