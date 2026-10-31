/**
 * Ambient declarations shared across the site scripts.
 *
 * These scripts are plain (non-module) browser scripts loaded via <script defer>
 * and communicate through globals hung off `window`. This file types those
 * globals.
 */

/** Console methods `Log` can dispatch to. */
type LogLevel = "log" | "info" | "warn" | "error" | "debug";

/** Levels as written at the call site — "warn" and "Warn" are both accepted. */
type LogLevelInput = LogLevel | Capitalize<LogLevel>;

interface AdsApi {
    initAds(): void;
    makeAdsRed(): void;
}

interface Navigator {
    /**
     * Global Privacy Control, set by the browser or a privacy extension. Not in
     * lib.dom yet. Read by ui/reading.ts, which collects nothing when it is on.
     */
    globalPrivacyControl?: boolean;
}

interface Window {
    /** Dev-only console output; silent in production. See core/logger.ts. */
    Log: (level: LogLevelInput, ...args: unknown[]) => void;

    /**
     * Set by the solver bundle (react-solvers/src/main.tsx) so ui/line-flagger.ts
     * can read a mounted solver's inputs when someone reports it. Optional: it
     * only exists on pages that mount a solver, which most guide pages don't.
     */
    SolverReport?: {
        read: (root: HTMLElement) => { name: string; inputs: Record<string, unknown> } | null;
    };

    Ads: AdsApi;

    /** AdSense queue injected by the external adsbygoogle.js loader. */
    adsbygoogle?: unknown[];
}
