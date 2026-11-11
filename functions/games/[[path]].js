// Serves guide screenshots from R2, to stay under the 20,000-file Pages deployment limit.
//     /games/BO7/astra/pictures/x.webp  ->  img/BO7/astra/pictures/x.webp
//
// IMPORTANT: this Function takes precedence over static assets on all of /games/,
// where every guide's HTML lives, so non-images MUST fall through via next().

const IMAGE = /\.(webp|png|jpe?g|gif)$/i;

// Game folders are uppercase and paths are case-sensitive, but some crawlers
// (Bingbot, MJ12bot) request /games/iw/..., which 404s. Keep in step with src/games/.
const GAME_FOLDERS = new Map(
    ["AW", "BO1", "BO2", "BO3", "BO4", "BO6", "BO7", "BO_CW", "IW", "VG", "WAW", "WW2"]
        .map((f) => [f.toLowerCase(), f]),
);

// Must match TIERS in build_scripts/r2.mjs, which writes variants/<tier>/.
const TIERS = new Set(["1280", "1920"]);

const CONTENT_TYPES = {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
};

// Images aren't content-hashed, so always revalidate; R2 ETags make that a 304.
const CACHE_CONTROL = "public, no-cache";

export async function onRequestGet(context) {
    const { request, env, next, waitUntil } = context;
    const url = new URL(request.url);

    // pathname is "/games/<folder>/...", so the folder is segment 2.
    const segments = url.pathname.split("/");
    const folder = GAME_FOLDERS.get(segments[2]?.toLowerCase());
    if (folder && folder !== segments[2]) {
        segments[2] = folder;
        url.pathname = segments.join("/");
        return Response.redirect(url.toString(), 301);
    }

    if (!IMAGE.test(url.pathname)) return next();

    // No binding (e.g. local wrangler): fall through to any copy in the deployment.
    if (!env.IMAGES) return next();

    // Inert under `no-cache` (Cloudflare never stores it), so every request costs
    // an R2 Class B op. Kept so it works if CACHE_CONTROL ever gets a real max-age.
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    // pathname is percent-encoded; R2 keys are raw.
    const rel = decodeURIComponent(url.pathname).slice("/games".length);

    // Allowlisted so ?w= can't reach arbitrary bucket keys.
    const asked = url.searchParams.get("w");
    const tier = asked && TIERS.has(asked) ? asked : null;

    // `onlyIf` lets R2 evaluate If-None-Match / If-Modified-Since; a failed
    // condition returns metadata with no body, the 304 case.
    let object = null;
    let served = "master";

    if (tier) {
        object = await env.IMAGES.get(`variants/${tier}${rel}`, { onlyIf: request.headers });
        if (object) served = tier;
    }

    // No variant when the image is already smaller than the tier, or not generated yet.
    if (!object) {
        object = await env.IMAGES.get(`img${rel}`, { onlyIf: request.headers });
    }

    if (object === null) {
        return new Response("Image not found", {
            status: 404,
            headers: { "Cache-Control": "public, max-age=60" },
        });
    }

    const headers = new Headers();
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", CACHE_CONTROL);

    // The URL doesn't show which copy answered, so this is the only way to verify it.
    headers.set("X-Image-Tier", served);

    // src/_headers doesn't apply to Function responses; keep these in step with its `/*` block.
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // `body` is absent when the conditional request matched.
    if (!("body" in object) || object.body === null) {
        return new Response(null, { status: 304, headers });
    }

    const ext = url.pathname.split(".").pop().toLowerCase();
    headers.set(
        "Content-Type",
        object.httpMetadata?.contentType || CONTENT_TYPES[ext] || "application/octet-stream",
    );
    headers.set("Content-Length", String(object.size));

    const response = new Response(object.body, { status: 200, headers });

    if (waitUntil) waitUntil(cache.put(request, response.clone()));

    return response;
}
