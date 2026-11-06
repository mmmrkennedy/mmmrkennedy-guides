const version = Date.now();

export default {
    buildVersion: version,
    buildVersionShort: version.toString().slice(-6),
    bundled: process.env.BUNDLE === "true",
    // `eleventy --serve`. Lets a stub guide render its real body while it is
    // being written; see the placeholder in base.njk. Nothing else should key off
    // this: a disabled guide is disabled in dev too.
    serve: process.env.ELEVENTY_RUN_MODE === "serve",
    name: "Zombies Guides",
    url: process.env.NODE_ENV === "production" ? "https://mmmrkennedy.com" : "http://localhost:8080",
};
