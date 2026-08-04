/* eslint-disable no-console -- the whole point of this file: the console calls the
   rest of the codebase is linted away from are funnelled through here instead. */

/**
 * Console logging that only speaks up on the dev server.
 *
 * Readers get nothing: a warning about a failed prefetch or a missing lightbox
 * element is noise in their console and, worse, reads as a broken site to anyone
 * who opens devtools. Locally the same message is the whole point.
 *
 * Usage mirrors console, with the level as the first argument:
 *
 *   window.Log("warn", "Flag submission failed:", err);
 *   window.Log("error", `Solver component ${i} failed to load:`, reason);
 *
 * ads.ts calls it as `window.Log?.(...)` instead — it is an async island in its
 * own bundle and can run before this file has defined the global.
 *
 * To debug the live site, set `localStorage.debug = "1"` in that browser and
 * reload — output stays on for that one browser until the key is removed.
 *
 * Loaded first of the core scripts (base.njk and JS_CORE_ORDER in
 * build_scripts/minify-assets.js) so `window.Log` exists before anything calls it.
 * These are plain non-module scripts sharing one global scope, so the body is
 * wrapped: `isLocalHost` is already a private helper in two other files, and only
 * `window.Log` should be global.
 */
(function () {
    /** Local dev server. Same hosts view-counter.ts and line-flagger.ts treat as local. */
    function isLocalHost(): boolean {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    }

    /** Manual override so a production bug can be traced in a real browser. */
    function debugOptIn(): boolean {
        try {
            return window.localStorage.getItem("debug") === "1";
        } catch {
            // localStorage blocked (private mode / cookies off) — no opt-in available
            return false;
        }
    }

    // Resolved once: neither the hostname nor the opt-in can change without a reload.
    const loggingOn = isLocalHost() || debugOptIn();

    window.Log = function devLog(level: LogLevelInput, ...args: unknown[]): void {
        if (!loggingOn) return;

        // Accepts "Warn" as readily as "warn"; anything unrecognised still prints
        // rather than vanishing, since a dropped message is worse than a mislabelled one.
        const method = String(level).toLowerCase();
        const write =
            method === "warn" || method === "error" || method === "info" || method === "debug"
                ? console[method]
                : console.log;

        // Bound to console so the call site is reported correctly in devtools.
        write.apply(console, args);
    };
})();
