/* eslint-disable no-console -- the whole point of this file: the console calls the
   rest of the codebase is linted away from are funnelled through here instead. */

/**
 * Logs only on localhost. To debug the live site, set `localStorage.debug = "1"`
 * and reload.
 *
 *   log("warn", "Flag submission failed:", err);
 */

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

type LogLevelInput = LogLevel | Capitalize<LogLevel>;

// Same hosts footer.ts and line-flagger.ts treat as local.
function isLocalHost(): boolean {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

function debugOptIn(): boolean {
    try {
        return window.localStorage.getItem("debug") === "1";
    } catch {
        // localStorage blocked (private mode / cookies off)
        return false;
    }
}

const loggingOn = isLocalHost() || debugOptIn();

export function log(level: LogLevelInput, ...args: unknown[]): void {
    if (!loggingOn) return;

    const method = String(level).toLowerCase();
    const write =
        method === "warn" || method === "error" || method === "info" || method === "debug"
            ? console[method]
            : console.log;

    write.apply(console, args);
}
