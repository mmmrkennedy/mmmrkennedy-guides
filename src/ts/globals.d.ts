/** The site scripts are non-module <script defer> files that share state through `window`. */

interface AdsApi {
    initAds(): void;
    makeAdsRed(): void;
}

interface Navigator {
    /** Global Privacy Control. Not in lib.dom yet. */
    globalPrivacyControl?: boolean;
}

interface Window {
    /** Set by react-solvers/src/main.tsx for ui/line-flagger.ts, only on pages that mount a solver. */
    SolverReport?: {
        read: (root: HTMLElement) => { name: string; inputs: Record<string, unknown> } | null;
    };

    Ads: AdsApi;

    /** AdSense queue injected by the external adsbygoogle.js loader. */
    adsbygoogle?: unknown[];
}
