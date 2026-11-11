const version = Date.now();

export default {
    buildVersion: version,
    buildVersionShort: version.toString().slice(-6),
    bundled: process.env.BUNDLE === "true",
    // Only for letting a stub guide render its body in dev (see base.njk).
    // Nothing else should key off this.
    serve: process.env.ELEVENTY_RUN_MODE === "serve",
    name: "Zombies Guides",
    url: process.env.NODE_ENV === "production" ? "https://mmmrkennedy.com" : "http://localhost:8080",
};
