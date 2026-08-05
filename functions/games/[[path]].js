// GET /games/**/*.{webp,png,jpg,jpeg,gif}
// Serves guide screenshots from R2 instead of from the deployment.
//
// Why: 4,555 images (2.8GB) used to ship inside every Pages deployment, against
// a 20,000-file-per-deployment cap that was already 23% used and climbing with
// each new map. They now live in an R2 bucket and are streamed from here, so a
// deployment carries only the pages themselves (~150 files).
//
// URLs are deliberately UNCHANGED. Every guide references its screenshots
// relatively (`pictures/main_ee/foo.webp`), and rewriting thousands of those
// links would be a large, risky diff that buys nothing — so this maps the
// existing URL onto an R2 key instead:
//
//     /games/BO7/astra/pictures/x.webp  ->  img/BO7/astra/pictures/x.webp
//
// IMPORTANT: a Pages Function claims its entire route and takes precedence over
// static assets. This file sits at /games/[[path]], which is also where every
// guide's HTML lives, so anything that is not an image MUST fall through via
// next() — otherwise this single file 404s the whole site.

const IMAGE = /\.(webp|png|jpe?g|gif)$/i;

const CONTENT_TYPES = {
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
};

// Images are not content-hashed, so a changed screenshot keeps its URL. Same
// bargain src/_headers already documents for the static ones: store it, but
// revalidate before reuse. R2 gives every object an ETag, so that revalidation
// is a bodyless 304 rather than a re-download.
const CACHE_CONTROL = "public, no-cache";

export async function onRequestGet(context) {
    const { request, env, next, waitUntil } = context;
    const url = new URL(request.url);

    // Guide pages, solver pages, anything without an image extension: hand
    // straight back to the static assets. This is the guard that keeps the
    // Function from swallowing the site.
    if (!IMAGE.test(url.pathname)) return next();

    // No binding — local `wrangler pages dev` without one, or a misconfigured
    // deploy. Fall through rather than hard-fail: if a copy of the image is
    // still in the deployment it gets served, and the page looks normal.
    if (!env.IMAGES) return next();

    // Serve from the edge when we can. A cache hit never calls R2, so it costs
    // no Class B operation — which is what keeps this inside the free tier.
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    // pathname is percent-encoded; R2 keys are raw.
    const key = "img" + decodeURIComponent(url.pathname).slice("/games".length);

    // Passing the request headers as `onlyIf` lets R2 evaluate If-None-Match /
    // If-Modified-Since for us. When the condition fails it returns metadata
    // with no body, which is exactly the 304 case.
    const object = await env.IMAGES.get(key, { onlyIf: request.headers });

    if (object === null) {
        return new Response("Image not found", {
            status: 404,
            headers: { "Cache-Control": "public, max-age=60" },
        });
    }

    const headers = new Headers();
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", CACHE_CONTROL);
    headers.set("X-Content-Type-Options", "nosniff");

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

    // Only full 200s are worth caching, and the body has to be cloned because
    // the original is streamed to the client.
    if (waitUntil) waitUntil(cache.put(request, response.clone()));

    return response;
}
