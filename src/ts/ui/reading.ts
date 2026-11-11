/**
 * Reading analytics, posted to /api/reading. Anonymous by design: no cookies,
 * `sess` dies with the tab, `pvid` is never stored.
 *
 * Readers alt-tab to the game constantly, so every beacon resends the full
 * cumulative state under the same `pvid` and the server upserts one row.
 */
document.addEventListener("DOMContentLoaded", () => {
    const ENDPOINT = "/api/reading";
    const SCHEMA_VERSION = 1;
    const OPT_OUT_KEY = "mk_no_analytics";
    const SESSION_KEY = "mk_read_sess";

    const TICK_MS = 1000;
    const MAX_SECTIONS = 60;
    const MAX_EVENTS = 40;
    const MAX_EVENT_VALUE = 120;
    const MAX_SECONDS = 7200;
    const MIN_SEND_GAP_MS = 5000;
    const SOLVER_POLL_MS = 500;
    const SOLVER_POLL_TRIES = 24;
    const SOLVER_DEBOUNCE_MS = 800;

    if (document.body.hasAttribute("data-not-found")) return;

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("analytics");

    // Keeps the site author's own browsing out of the numbers.
    if (mode === "off") {
        store(OPT_OUT_KEY, "1");
        return;
    }
    if (mode === "on") remove(OPT_OUT_KEY);

    // `?analytics=debug` allows localhost, for testing `wrangler pages dev` against a local D1.
    const debug = mode === "debug";
    if (!debug && isLocalHost()) return;
    if (readStore(OPT_OUT_KEY)) return;
    if (privacySignalled()) return;

    const path = normalizePath(window.location.pathname);

    const anchors = collectAnchors();

    const pvid = randomHex(8);
    const sess = sessionId();
    const ref = referrerBucket();
    const device = deviceClass();

    /** Section id -> seconds. A key with 0 still means "reached". */
    const dwell = new Map<string, number>();
    const events: Array<[string, string]> = [];

    let lastScrollTop = -1;
    let ticksSinceMeasure = 0;
    let currentId: string | null = null;

    let engaged = 0;
    let depth = 0;
    let hides = 0;
    let secFirst: string | null = null;
    let secLast: string | null = null;

    let lastSendAt = 0;
    let lastSentEngaged = -1;

    interface SolverStat {
        name: string | null;
        m: number;
        e: number;
        n: number;
        f: number;
        t: number;
    }
    const solverStats = new Map<HTMLElement, SolverStat>();
    const solverState = new Map<HTMLElement, string>();
    const solverTimers = new Map<HTMLElement, number>();
    const solversVisible = new Set<HTMLElement>();

    startSectionTracking();
    startSolverTracking();
    startEventTracking();

    window.setInterval(tick, TICK_MS);

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "hidden") return;
        hides++;
        flush(false);
    });
    window.addEventListener("pagehide", () => flush(true));

    /**
     * Sub-headings are tracked alongside containers so dwell lands on individual
     * steps; each anchor's span runs to the next anchor in document order.
     */
    function collectAnchors(): HTMLElement[] {
        const selector = ".content-container[id], .content-container [class*='title-tier-'][id]";
        const found = Array.from(document.querySelectorAll<HTMLElement>(selector));
        if (found.length > 0) return found;
        // Home page: no containers carry ids, only one h2[id] per game.
        return Array.from(document.querySelectorAll<HTMLElement>("h2[id]"));
    }

    function startSectionTracking(): void {
        if (anchors.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) markReached((entry.target as HTMLElement).id);
                }
            },
            { threshold: 0 },
        );
        for (const el of anchors) observer.observe(el);
    }

    function markReached(id: string): void {
        if (!id) return;
        if (!dwell.has(id)) dwell.set(id, 0);
        if (!secFirst) secFirst = id;
    }

    /** Credits one section per second, so section seconds sum to engaged time. */
    function tick(): void {
        if (document.visibilityState !== "visible") return;
        if (!document.hasFocus()) return;

        if (engaged < MAX_SECONDS) engaged++;
        updateDepth();

        const id = currentAnchorId();
        if (id) {
            secLast = id;
            const seconds = dwell.get(id) ?? 0;
            if (seconds < MAX_SECONDS) dwell.set(id, seconds + 1);
        }

        for (const root of solversVisible) {
            const stat = solverStats.get(root);
            if (stat && stat.t < MAX_SECONDS) stat.t++;
        }
    }

    /**
     * Cached until the page scrolls to avoid a forced layout every tick, with a
     * re-measure every 10 ticks to catch late images shifting the page.
     */
    function currentAnchorId(): string | null {
        if (anchors.length === 0) return null;

        const scrollTop = window.scrollY;
        ticksSinceMeasure++;
        if (scrollTop === lastScrollTop && ticksSinceMeasure < 10) return currentId;
        lastScrollTop = scrollTop;
        ticksSinceMeasure = 0;

        const mid = window.innerHeight / 2;

        let found: string | null = null;
        for (const el of anchors) {
            if (el.getBoundingClientRect().top > mid) break; // document order: the rest are lower
            if (el.id) found = el.id;
        }
        // Above the first anchor credits nothing, or every guide's first section gets inflated.
        currentId = found;
        return found;
    }

    function updateDepth(): void {
        const el = document.documentElement;
        const total = el.scrollHeight;
        if (total <= 0) return;
        const pct = Math.round(Math.min(100, ((window.scrollY + el.clientHeight) / total) * 100));
        if (pct > depth) depth = pct;
    }

    /**
     * Reads window.SolverReport (react-solvers/solver-report.tsx), which publishes
     * inputs only, not answers, so `f` (all inputs filled) is the proxy for success.
     */
    function startSolverTracking(): void {
        const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-solver]"));
        if (roots.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const el = entry.target as HTMLElement;
                    if (entry.isIntersecting) solversVisible.add(el);
                    else solversVisible.delete(el);
                }
            },
            { threshold: 0 },
        );

        for (const root of roots) {
            solverStats.set(root, { name: null, m: 0, e: 0, n: 0, f: 0, t: 0 });
            observer.observe(root);
            for (const type of ["input", "change", "pointerdown"]) {
                root.addEventListener(type, () => onSolverInput(root), { passive: true });
            }
        }

        // Each solver is a dynamic import, so poll for the mount.
        const pending = new Set(roots);
        let tries = 0;
        const timer = window.setInterval(() => {
            tries++;
            for (const root of pending) {
                const report = window.SolverReport?.read(root) ?? null;
                if (!report) continue;
                pending.delete(root);
                const stat = solverStats.get(root);
                if (stat) {
                    stat.name = report.name;
                    stat.m = 1;
                }
            }
            if (pending.size === 0 || tries >= SOLVER_POLL_TRIES) window.clearInterval(timer);
        }, SOLVER_POLL_MS);
    }

    function onSolverInput(root: HTMLElement): void {
        const stat = solverStats.get(root);
        if (stat) stat.e = 1;

        const existing = solverTimers.get(root);
        if (existing) window.clearTimeout(existing);
        solverTimers.set(
            root,
            window.setTimeout(() => readSolverState(root), SOLVER_DEBOUNCE_MS),
        );
    }

    function readSolverState(root: HTMLElement): void {
        const report = window.SolverReport?.read(root) ?? null;
        const stat = solverStats.get(root);
        if (!report || !stat) return;
        if (!stat.name) {
            stat.name = report.name;
            stat.m = 1;
        }

        let serialized: string;
        try {
            serialized = JSON.stringify(report.inputs);
        } catch {
            return;
        }
        if (serialized === solverState.get(root)) return;
        solverState.set(root, serialized);
        stat.n++;
        stat.f = allFilled(report.inputs) ? 1 : 0;
    }

    /** Mirrors what formatValue in line-flagger.ts calls "(none)" and "(blank)". */
    function allFilled(inputs: Record<string, unknown>): boolean {
        const values = Object.values(inputs);
        return values.length > 0 && values.every(isFilled);
    }

    function isFilled(value: unknown): boolean {
        if (value === null || value === undefined) return false;
        if (typeof value === "string") return value.trim() !== "";
        if (typeof value === "number") return Number.isFinite(value);
        if (typeof value === "boolean") return true;
        if (Array.isArray(value)) return value.length > 0 && value.every(isFilled);
        return true;
    }

    /** An `img` event means a lightbox opened, so isMedia must match lightbox.ts. */
    function startEventTracking(): void {
        document.addEventListener(
            "click",
            (event) => {
                const target = event.target;
                if (!(target instanceof Element)) return;

                const tab = target.closest(".path-tabs__tab");
                if (tab) {
                    record("tab", (tab.textContent ?? "").trim());
                    return;
                }

                if (target.closest("button.btn--fixed.bottom-right")) {
                    record("top", "");
                    return;
                }

                const anchor = target.closest<HTMLAnchorElement>("a[href]");
                if (!anchor) return;
                const href = anchor.getAttribute("href") ?? "";
                if (!href) return;

                if (href.startsWith("#")) {
                    const fromToc = anchor.closest(".quick-links-container, .sidebar-toc") !== null;
                    record(fromToc ? "toc" : "nav", href.slice(1));
                    return;
                }

                if (isMedia(href)) {
                    record("img", shortMediaName(href));
                    return;
                }

                let dest: URL;
                try {
                    dest = new URL(href, window.location.href);
                } catch {
                    return;
                }
                if (dest.protocol !== "http:" && dest.protocol !== "https:") return;
                if (dest.host === window.location.host) record("nav", dest.pathname);
                else record("out", dest.host);
            },
            true,
        );
    }

    function record(type: string, value: string): void {
        if (events.length >= MAX_EVENTS) return;
        events.push([type, value.slice(0, MAX_EVENT_VALUE)]);
    }

    /** Keep in sync with the mediaExtensions list in ui/lightbox.ts. */
    function isMedia(href: string): boolean {
        const lower = href.toLowerCase().split(/[?#]/)[0];
        const extensions = [
            ".webp",
            ".jpg",
            ".jpeg",
            ".png",
            ".gif",
            ".webm",
            ".mp4",
            ".mov",
            ".flac",
            ".mp3",
            ".ogg",
            ".wav",
            ".m4a",
        ];
        return extensions.some((ext) => lower.endsWith(ext));
    }

    function shortMediaName(href: string): string {
        const clean = href.split(/[?#]/)[0];
        return clean.split("/").slice(-2).join("/");
    }

    function flush(force: boolean): void {
        if (engaged === 0 && dwell.size === 0) return;
        if (!force && Date.now() - lastSendAt < MIN_SEND_GAP_MS) return;
        if (engaged === lastSentEngaged && lastSendAt !== 0) return;

        lastSendAt = Date.now();
        lastSentEngaged = engaged;
        post(JSON.stringify(payload()));
    }

    function payload(): Record<string, unknown> {
        const entries = Array.from(dwell.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, MAX_SECTIONS);
        const sections: Record<string, number> = {};
        for (const [id, seconds] of entries) sections[id] = seconds;

        const solvers: Record<string, Omit<SolverStat, "name">> = {};
        for (const stat of solverStats.values()) {
            if (!stat.name) continue; // never mounted
            solvers[stat.name] = { m: stat.m, e: stat.e, n: stat.n, f: stat.f, t: stat.t };
        }

        return {
            v: SCHEMA_VERSION,
            id: pvid,
            p: path,
            s: sess,
            r: ref,
            d: device,
            t: engaged,
            z: depth,
            h: hides,
            f: secFirst,
            l: secLast,
            sec: sections,
            ev: events,
            sv: solvers,
        };
    }

    function post(body: string): void {
        // Same-origin, so the JSON content type costs no preflight.
        try {
            const blob = new Blob([body], { type: "application/json" });
            if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;
        } catch {
            /* fall through to fetch */
        }
        try {
            void fetch(ENDPOINT, {
                method: "POST",
                body,
                keepalive: true,
                headers: { "Content-Type": "application/json" },
            }).catch(() => {
                /* a dropped beacon is a missing row, not an error worth showing */
            });
        } catch {
            /* nothing left to try */
        }
    }

    function referrerBucket(): string {
        const raw = document.referrer;
        if (!raw) return "direct";
        let host: string;
        try {
            host = new URL(raw).host.toLowerCase();
        } catch {
            return "other";
        }
        if (host === window.location.host) return "internal";

        const patterns: Array<[RegExp, string]> = [
            [/(^|\.)google\./, "google"],
            [/(^|\.)bing\./, "bing"],
            [/(^|\.)duckduckgo\./, "duckduckgo"],
            [/(^|\.)yahoo\./, "yahoo"],
            [/(^|\.)reddit\./, "reddit"],
            [/(^|\.)youtube\./, "youtube"],
            [/^youtu\.be$/, "youtube"],
            [/(^|\.)discord(app)?\./, "discord"],
            [/(^|\.)twitter\./, "twitter"],
            [/(^|\.)x\.com$/, "twitter"],
            [/^t\.co$/, "twitter"],
            [/(^|\.)facebook\./, "facebook"],
        ];
        for (const [pattern, name] of patterns) {
            if (pattern.test(host)) return name;
        }
        return "other";
    }

    function deviceClass(): string {
        const width = window.innerWidth || document.documentElement.clientWidth || 0;
        if (width > 0 && width < 600) return "mobile";
        if (width < 1024) return "tablet";
        return "desktop";
    }

    function sessionId(): string | null {
        try {
            const existing = sessionStorage.getItem(SESSION_KEY);
            if (existing && /^[a-f0-9]{8}$/.test(existing)) return existing;
            const id = randomHex(4);
            sessionStorage.setItem(SESSION_KEY, id);
            return id;
        } catch {
            return null; // private mode
        }
    }

    function randomHex(bytes: number): string {
        const buffer = new Uint8Array(bytes);
        crypto.getRandomValues(buffer);
        let out = "";
        for (const byte of buffer) out += byte.toString(16).padStart(2, "0");
        return out;
    }

    function privacySignalled(): boolean {
        return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
    }

    function isLocalHost(): boolean {
        const host = window.location.hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    }

    /** Mirror the server's normalization so a path here matches one in `views`. */
    function normalizePath(raw: string): string {
        let out = raw.startsWith("/") ? raw : "/" + raw;
        if (out.length > 1) out = out.replace(/\/+$/, "");
        return out;
    }

    function store(key: string, value: string): void {
        try {
            localStorage.setItem(key, value);
        } catch {
            /* storage blocked; opting out just won't persist */
        }
    }

    function remove(key: string): void {
        try {
            localStorage.removeItem(key);
        } catch {
            /* as above */
        }
    }

    function readStore(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }
});
