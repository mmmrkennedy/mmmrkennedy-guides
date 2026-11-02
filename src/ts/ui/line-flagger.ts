import { log } from "../core/logger";

/**
 * Line flagger
 * ------------
 * Lets readers flag any sentence or bullet in a guide as unclear / out of date /
 * incorrect / buggy, with a required detail note, via POST /api/feedback/flag (a
 * D1-backed Pages Function). On load it also asks GET /api/feedback?path= which
 * lines have crossed the "buggy" report threshold and injects a caution note on
 * each, so readers are warned about steps many others report broken.
 *
 * Each flaggable line gets a stable content hash (FNV-1a of its normalized text)
 * as data-line-id. The same hash is recomputed on render to match server counts
 * back to DOM lines, so a flag (and any note) retires automatically once the
 * wording is edited — the line you flagged no longer exists.
 *
 * Network: like footer.ts, the eleventy dev server has no Functions, so a
 * failed call on localhost is treated as a silent demo no-op rather than a
 * user-facing error. Under `wrangler pages dev` and in production the real
 * endpoints are hit.
 *
 * SOLVER FLAGS
 * ------------
 * A solver gets an always-visible report button instead of a per-line ⚑. It
 * attaches a snapshot of the reader's inputs only: solvers are deterministic, so
 * the answer can be recomputed from them.
 *
 * Inputs come from the solver via window.SolverReport (react-solvers/src/
 * solver-report.tsx), because many solvers keep them in component state. The DOM
 * scrape is a fallback for a solver that doesn't publish them, and marks itself
 * `scraped: true`. Nothing outside the solver root is captured, and the reader sees
 * the whole payload before it sends.
 */
type FeedbackReason = "unclear" | "outdated" | "wrong" | "buggy";

/** Reason chips, in the order they're offered. Labels differ per mode. */
const LINE_REASONS: ReadonlyArray<readonly [FeedbackReason, string]> = [
    ["unclear", "Doesn’t make sense"],
    ["outdated", "Out of date"],
    ["wrong", "Incorrect"],
    ["buggy", "Doesn’t work / buggy"],
];

/**
 * Same four reasons — the server enum is unchanged — relabelled for a solver,
 * and led by 'wrong', which is what a solver report almost always is.
 */
const SOLVER_REASONS: ReadonlyArray<readonly [FeedbackReason, string]> = [
    ["wrong", "Gives the wrong answer"],
    ["buggy", "Broken / errors out"],
    ["unclear", "Confusing to use"],
    ["outdated", "Out of date"],
];

/** The solver inputs captured alongside a solver flag. */
interface SolverSnapshot {
    /** Schema version, so a future shape change is detectable in the admin UI. */
    v: 2;
    solver: string;
    /**
     * The reader's inputs: label -> whatever JSON describes that input best. A
     * number for a dial, a string for a typed word, an array of [row, col] pairs
     * for a board. Never anything the solver computed from them.
     */
    state: Record<string, unknown>;
    /** True when these came from the DOM fallback rather than the solver itself. */
    scraped?: true;
    /** site.buildVersion, from <meta name="build">: which deploy produced this. */
    build?: string;
    /** Viewport, for the layout-dependent reports. */
    vp?: string;
}

/* Harvest limits. Bounded on the client so a hostile or pathological page can't
 * post a huge body; the server re-enforces its own caps regardless. */
const SNAP_MAX_KEYS = 60;
const SNAP_MAX_KEY = 60;
const SNAP_MAX_VALUE = 200;
/**
 * Kept under the server's 8192 so a snapshot never round-trips only to be
 * rejected. Measured in UTF-16 code units, exactly as the server measures it —
 * an approximation of bytes, but the same approximation on both sides, which is
 * the property that matters. Sized for the largest real input: a board reported
 * as a list of coordinates.
 */
const SNAP_MAX_CHARS = 7800;

/**
 * Containers whose whole subtree is summarized as ONE entry, so their inner
 * controls aren't also harvested individually. Order is document order; the
 * first match wins and consumes everything below it.
 */
const HARVEST_SEL = [
    '[role="radiogroup"]',
    ".solver-slot-list",
    ".solver-grid",
    ".queens-board",
    "input",
    "select",
    "textarea",
    ".btn--solver.is-active",
    '[aria-pressed="true"]',
].join(", ");

/** Marks a cell/button as "on" across the solvers' various naming habits. */
const CELL_ON_SEL =
    '[aria-pressed="true"], [aria-checked="true"], .is-on, .is-selected, .is-filled, .is-active';

/**
 * Blocks nested inside a line that are lines of their own: they're excluded from
 * the line's text, and the ⚑ goes before the first of them rather than after the
 * whole subtree. `.table-scroll` is the wrapper the build puts around every
 * <table> (prepareTables in build_scripts/eleventy/tables.cjs), so a bare `table`
 * never appears as a child here.
 */
const NESTED_BLOCK = "ul, ol, table, p, h3, h4, .table-scroll";
/** Same set, matched only as a direct child. */
const NESTED_BLOCK_CHILD = NESTED_BLOCK.split(", ")
    .map((sel) => ":scope > " + sel)
    .join(", ");
/** Nested blocks plus the chrome this script injects — all skipped by lineText(). */
const NOT_OWN_TEXT = NESTED_BLOCK + ", .gfb-flag, .gfb-buggy-note";
/** Fewer text lines than this and the page is a solver or a stub: no flag launcher. */
const MIN_LINES_FOR_LAUNCHER = 5;

document.addEventListener("DOMContentLoaded", () => {
    // Pages can opt out (e.g. the home/index page) via <body data-no-flags>.
    if (document.body.hasAttribute("data-no-flags")) return;

    const lines = document.querySelectorAll<HTMLElement>(
        ".content-container p, .content-container :is(.title-tier-2, .title-tier-3, .title-tier-4), .content-container li:not(.dummy-li)"
    );

    // Without an SSR build a solver page can have no lines yet. Stay if a solver is
    // going to arrive, or the solver:hydrated listener below never registers.
    const solverIncoming = document.querySelector("[data-solver]") !== null;
    if (lines.length === 0 && !solverIncoming) return;

    const path = normalizePath(window.location.pathname);

    // ---- Toast ----
    const toast = document.createElement("div");
    toast.className = "gfb-toast";
    document.body.appendChild(toast);
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    function showToast(msg: string): void {
        toast.textContent = msg;
        toast.classList.add("is-on");
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("is-on"), 2600);
    }

    // ---- Shared "flag this line" popover ----
    const pop = document.createElement("div");
    pop.className = "gfb-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Flag this line");
    pop.hidden = true;
    pop.innerHTML =
        '<p class="gfb-pop__title">Flag this line</p>' +
        '<p class="gfb-pop__quote"></p>' +
        '<div class="gfb-pop__reasons"></div>' +
        "<textarea></textarea>" +
        // Behind a disclosure: most people reporting a wrong answer don't know the
        // right one.
        '<details class="gfb-pop__expected" hidden>' +
            "<summary>Do you know what the solution should be? (optional)</summary>" +
            '<input type="text" autocomplete="off" placeholder="e.g. Button #2">' +
        "</details>" +
        '<details class="gfb-pop__snap" hidden>' +
            "<summary>What’s being sent with report (your inputs)</summary>" +
            '<dl class="gfb-pop__snap-list"></dl>' +
        "</details>" +
        '<p class="gfb-pop__hint">Pick a reason and add at least a few words so we can act on it.</p>' +
        '<div class="gfb-pop__actions">' +
            '<button type="button" class="gfb-pop__btn gfb-pop__cancel">Cancel</button>' +
            '<button type="button" class="gfb-pop__btn gfb-pop__btn--send gfb-pop__send" disabled>Send</button>' +
        "</div>";
    document.body.appendChild(pop);

    // A touch screen has no hover to reveal a ⚑, and its keyboard and scrolling would
    // keep dismissing a floating popover. So it gets flag mode (see startPicking) and
    // the form as a bottom sheet. Decided by input type rather than width, so a
    // narrow desktop window keeps its hover flags.
    const isSheet = window.matchMedia("(hover: none)").matches;
    pop.classList.toggle("gfb-pop--sheet", isSheet);

    const titleEl = pop.querySelector<HTMLElement>(".gfb-pop__title")!;
    const quoteEl = pop.querySelector<HTMLElement>(".gfb-pop__quote")!;
    const reasonsEl = pop.querySelector<HTMLElement>(".gfb-pop__reasons")!;
    const expectedWrap = pop.querySelector<HTMLDetailsElement>(".gfb-pop__expected")!;
    const expectedInput = expectedWrap.querySelector<HTMLInputElement>("input")!;
    const textarea = pop.querySelector<HTMLTextAreaElement>("textarea")!;
    const snapEl = pop.querySelector<HTMLDetailsElement>(".gfb-pop__snap")!;
    const snapListEl = pop.querySelector<HTMLElement>(".gfb-pop__snap-list")!;
    const hintEl = pop.querySelector<HTMLElement>(".gfb-pop__hint")!;
    const sendBtn = pop.querySelector<HTMLButtonElement>(".gfb-pop__send")!;
    const cancelBtn = pop.querySelector<HTMLButtonElement>(".gfb-pop__cancel")!;

    let activeTarget: HTMLElement | null = null;
    let activeQuote = "";
    let sending = false;
    /** The line chosen in flag mode, highlighted while the sheet is open. */
    let pickedLine: HTMLElement | null = null;
    let picking = false;
    /** Replaced below on touch screens, which show page state while flagging. */
    let syncFlagMode = (): void => {};
    /** Set for a solver report, null for a line flag — the mode switch. */
    let activeSnapshot: SolverSnapshot | null = null;
    /**
     * Chips are rebuilt per mode rather than relabelled in place, because the two
     * modes also differ in ORDER: 'wrong' leads for a solver and would otherwise
     * sit third, behind two reasons that almost never apply to one.
     */
    let reasonBtns: HTMLButtonElement[] = [];

    const MIN_DETAIL = 4; // anti low-effort: must be MORE than 3 characters
    const DEFAULT_HINT = "Pick a reason and add at least a few words so we can act on it.";

    /**
     * Show an error in the hint line. Solver mode hides that line (the disclosure
     * above it already says what's attached), so anything reporting a problem has
     * to bring it back or the message would be written into a hidden element.
     */
    function showHintError(message: string): void {
        hintEl.textContent = message;
        hintEl.classList.add("is-error");
        hintEl.hidden = false;
    }

    function buildReasons(set: ReadonlyArray<readonly [FeedbackReason, string]>): void {
        reasonsEl.textContent = "";
        reasonBtns = set.map(([reason, label]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "gfb-reason";
            b.dataset.reason = reason;
            b.setAttribute("aria-pressed", "false");
            b.textContent = label;
            b.addEventListener("click", () => {
                for (const o of reasonBtns) o.setAttribute("aria-pressed", String(o === b));
                refresh();
            });
            reasonsEl.appendChild(b);
            return b;
        });
    }
    buildReasons(LINE_REASONS);

    function selectedReason(): FeedbackReason | null {
        for (const b of reasonBtns) {
            const r = b.dataset.reason;
            if (r && b.getAttribute("aria-pressed") === "true") {
                return r as FeedbackReason;
            }
        }
        return null;
    }
    function detailOk(): boolean {
        const v = textarea.value.trim();
        // > 3 chars, and not a single repeated character ("aaaa", "....")
        return v.length >= MIN_DETAIL && !/^(.)\1*$/.test(v);
    }
    function refresh(): void {
        sendBtn.disabled = sending || !(selectedReason() !== null && detailOk());
    }

    textarea.addEventListener("input", refresh);

    function resetForm(): void {
        for (const o of reasonBtns) o.setAttribute("aria-pressed", "false");
        textarea.value = "";
        expectedInput.value = "";
        expectedWrap.open = false;
        hintEl.textContent = DEFAULT_HINT;
        hintEl.classList.remove("is-error");
        hintEl.hidden = false;
        sending = false;
        sendBtn.disabled = true;
        sendBtn.textContent = "Send";
    }
    function closePop(): void {
        pop.hidden = true;
        activeTarget = null;
        activeSnapshot = null;
        pickedLine?.classList.remove("gfb-picked");
        pickedLine = null;
        resetForm();
        syncFlagMode();
    }

    /** Lift the sheet above the on-screen keyboard, which covers fixed elements. */
    function fitSheet(): void {
        const vv = window.visualViewport;
        if (!vv || pop.hidden) return;
        pop.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px";
        pop.style.maxHeight = Math.round(vv.height * 0.85) + "px";
    }
    if (isSheet) {
        window.visualViewport?.addEventListener("resize", fitSheet);
        window.visualViewport?.addEventListener("scroll", fitSheet);
    }

    /** Under the anchor, clamped to the viewport; flipped above if it'd overflow. */
    function positionPop(anchor: HTMLElement): void {
        if (isSheet) {
            fitSheet();
            syncFlagMode();
            return;
        }
        const r = anchor.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
        let top = r.bottom + 6;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
        pop.style.left = left + "px";
        pop.style.top = top + "px";
    }

    function openPop(flagBtn: HTMLElement, target: HTMLElement): void {
        activeTarget = target;
        activeSnapshot = null;
        buildReasons(LINE_REASONS);
        resetForm();
        titleEl.textContent = "Flag this line";
        textarea.placeholder = "Briefly, what’s wrong with this line? (required)";
        expectedWrap.hidden = true;
        snapEl.hidden = true;
        activeQuote = lineText(target);
        quoteEl.hidden = false;
        quoteEl.textContent = activeQuote.length > 90 ? activeQuote.slice(0, 90) + "…" : activeQuote;
        pop.hidden = false;
        positionPop(flagBtn);
    }

    /**
     * Solver mode. The snapshot is taken at open, not at send, so what the popover
     * shows is exactly what gets sent.
     */
    function openSolverPop(reportBtn: HTMLElement, root: HTMLElement): void {
        const name = root.dataset.solver || "UnknownSolver";
        activeTarget = root;
        // A capture that throws must lose the inputs, not the report.
        try {
            activeSnapshot = captureSolver(root, name);
        } catch (err) {
            log("warn", "[line-flagger] solver capture failed:", err);
            activeSnapshot = { v: 2, solver: name, state: {} };
        }
        buildReasons(SOLVER_REASONS);
        resetForm();
        titleEl.textContent = "Report a solver problem";
        // "What did you expect?" moved out to the optional disclosure below, so
        // asking it here too would be the same question twice.
        textarea.placeholder = "What happened? (required)";
        expectedWrap.hidden = false;
        // No standing hint in solver mode: the disclosure below already announces
        // what's attached, so a line repeating it is just noise. It comes back if
        // there's an error to report.
        hintEl.hidden = true;
        activeQuote = snapshotSummary(activeSnapshot);
        // The summary is already rendered field-by-field in the disclosure below,
        // so repeating it as a quote is noise.
        quoteEl.hidden = true;
        renderSnapshot(activeSnapshot);
        snapEl.hidden = false;
        snapEl.open = false;
        pop.hidden = false;
        positionPop(reportBtn);
    }

    /** Show the payload verbatim, so nothing is captured behind the reader's back. */
    function renderSnapshot(snap: SolverSnapshot): void {
        snapListEl.textContent = "";
        const row = (k: string, v: string): void => {
            const dt = document.createElement("dt");
            dt.textContent = k;
            const dd = document.createElement("dd");
            dd.textContent = v;
            snapListEl.append(dt, dd);
        };
        for (const [k, v] of Object.entries(snap.state)) row(k, formatValue(v));
        if (Object.keys(snap.state).length === 0) {
            row("(nothing entered yet)", "only which solver this is will be recorded");
        }
    }

    cancelBtn.addEventListener("click", closePop);
    sendBtn.addEventListener("click", () => {
        const reason = selectedReason();
        if (sending || reason === null || !detailOk()) {
            showHintError("Please pick a reason and add at least 4 meaningful characters.");
            return;
        }
        void sendFlag(reason);
    });

    async function sendFlag(reason: FeedbackReason): Promise<void> {
        if (!activeTarget) return;
        const target = activeTarget;
        const snap = activeSnapshot;

        interface FlagPayload {
            path: string;
            line_hash: string;
            quote: string;
            reason: FeedbackReason;
            detail: string;
            solver?: string;
            snapshot?: string;
            expected?: string;
        }

        const payload: FlagPayload = {
            path,
            // For a solver there is no line to hash, so the state stands in for
            // one: the same person re-reporting the same inputs dedupes against
            // the existing UNIQUE (line_hash, ip_hash, reason), while a genuinely
            // different broken combination files as its own flag. It also makes
            // the distinct-IP count per hash read as "N people hit this exact
            // input", which is the number worth triaging on.
            line_hash: snap ? snapshotHash(snap) : (target.dataset.lineId ?? ""),
            quote: activeQuote,
            reason,
            detail: textarea.value.trim(),
        };
        if (snap) {
            payload.solver = snap.solver;
            payload.snapshot = serializeSnapshot(snap);
            const expected = expectedInput.value.trim();
            if (expected) payload.expected = expected.slice(0, 200);
        }

        /** Solver roots get their own marker — .gfb-flagged styles a text line. */
        const markSent = (): void => {
            target.classList.add(snap ? "gfb-solver-flagged" : "gfb-flagged");
        };

        sending = true;
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending…";

        try {
            const res = await fetch("/api/feedback/flag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error("HTTP " + res.status);
            markSent();
            closePop();
            showToast("🚩 Thanks, flagged for review");
        } catch (err) {
            if (isLocalHost()) {
                // No Functions on the eleventy dev server: behave like the demo.
                log("warn", "[line-flagger] no backend on localhost; would POST", payload);
                markSent();
                closePop();
                showToast("🚩 Thanks, flagged for review (local demo)");
            } else {
                log("warn", "Flag submission failed:", err);
                sending = false;
                sendBtn.textContent = "Send";
                sendBtn.disabled = false;
                showHintError("Couldn’t send, please try again.");
            }
        }
    }

    document.addEventListener("click", (e) => {
        const t = e.target as Node | null;
        // A stray tap must not throw away a half-typed note: the sheet has Cancel.
        if (isSheet || pop.hidden || (t && pop.contains(t))) return;
        if (t instanceof Element && t.closest(".gfb-flag, .gfb-solver-flag")) return;
        closePop();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        stopPicking();
        closePop();
    });
    if (!isSheet) window.addEventListener("resize", closePop);
    // Capture phase, so a scroll anywhere on the page dismisses the popover it
    // would otherwise leave stranded — except a scroll INSIDE it, which a solver
    // snapshot long enough to overflow makes routine.
    window.addEventListener(
        "scroll",
        (e) => {
            const t = e.target as Node | null;
            if (isSheet || (t && pop.contains(t))) return;
            closePop();
        },
        true,
    );

    // ---- Attach a ⚑ + stable id to each leaf paragraph / bullet ----
    const flaggable: HTMLElement[] = [];

    /**
     * Line hashes that /api/feedback reported as buggy, or null until it answers.
     *
     * Held rather than consumed, because solver lines are decorated after this
     * fetch may already have resolved (see the deferral below). Either order has
     * to end up with the same notes: a line decorated first gets its note when
     * the fetch lands, one decorated later reads the cached set on the way in.
     */
    let buggyHashes: Set<string> | null = null;

    function decorate(el: HTMLElement): void {
        // Flaggable when the line has its own text. lineText() excludes any
        // nested list/table/paragraph (each its own flaggable line), so an <li>
        // that introduces a sublist (e.g. "Wait for X to spawn." + <ul>) is still
        // flaggable by its own wording, while a pure grouping <li> is skipped.
        if (!lineText(el)) return;
        if (el.classList.contains("gfb-flaggable")) return; // already done
        el.classList.add("gfb-flaggable");
        el.dataset.lineId = lineId(el);
        flaggable.push(el);

        const flag = document.createElement("button");
        flag.type = "button";
        flag.className = "gfb-flag";
        flag.setAttribute("aria-label", "Flag this line as confusing or wrong");
        flag.textContent = "⚑";
        flag.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!pop.hidden && activeTarget === el) {
                closePop();
                return;
            }
            openPop(flag, el);
        });
        // Put the ⚑ at the end of the line's own text — before any nested
        // sublist/table — not after the whole subtree.
        const nested = el.querySelector(NESTED_BLOCK_CHILD);
        if (nested) el.insertBefore(flag, nested);
        else el.appendChild(flag);

        maybeInjectBuggyNote(el);
    }

    function maybeInjectBuggyNote(el: HTMLElement): void {
        if (!buggyHashes || !buggyHashes.has(el.dataset.lineId ?? "")) return;
        if (el.previousElementSibling?.classList.contains("gfb-buggy-note")) return;
        if (el.firstElementChild?.classList.contains("gfb-buggy-note")) return;
        injectBuggyNote(el);
    }

    /**
     * Lines inside a prerendered solver are left alone here, because hydration would
     * remove the ⚑ buttons. They're decorated on solver:hydrated instead. Hashes are
     * content-based, so deferring doesn't change a line's id.
     */
    for (const el of lines) {
        if (el.closest("[data-solver]")) continue;
        decorate(el);
    }

    // ---- Flag mode (touch only) ----
    const banner = document.createElement("div");

    function startPicking(): void {
        picking = true;
        const barBottom = document.querySelector(".top-buttons-background-box")?.getBoundingClientRect().bottom ?? 0;
        banner.style.top = barBottom + "px";
        window.addEventListener("click", pickLine, true);
        syncFlagMode();
    }

    function stopPicking(): void {
        if (!picking) return;
        picking = false;
        window.removeEventListener("click", pickLine, true);
        syncFlagMode();
    }

    /**
     * Runs ahead of every other click handler, so a tap on a link or image inside a
     * line selects the line instead of opening it. Tabs and disclosures still work,
     * because the line being reported may be inside one.
     */
    function pickLine(e: Event): void {
        const t = e.target;
        if (!(t instanceof Element) || t.closest(".gfb-pick-banner, .path-tabs__tab, summary")) return;
        e.preventDefault();
        e.stopPropagation();
        const line = t.closest<HTMLElement>(".gfb-flaggable");
        if (!line) return;
        stopPicking();
        pickedLine = line;
        line.classList.add("gfb-picked");
        openPop(line, line);

        // Keep the chosen line in sight above the sheet.
        const barBottom = document.querySelector(".top-buttons-background-box")?.getBoundingClientRect().bottom ?? 0;
        const r = line.getBoundingClientRect();
        if (r.top < barBottom + 8 || r.bottom > pop.getBoundingClientRect().top - 8) {
            window.scrollBy({ top: r.top - barBottom - 16, behavior: "auto" });
        }
    }

    function setUpFlagMode(): void {
        let launcher: HTMLButtonElement | null = null;
        let pastContents = true;

        syncFlagMode = () => {
            const flagging = picking || !pop.hidden;
            document.body.classList.toggle("gfb-picking", picking);
            document.body.classList.toggle("gfb-flagging", flagging);
            banner.hidden = !picking;
            if (launcher) launcher.hidden = flagging || !pastContents;
        };

        // A page that is mostly a solver already has the solver's own report button,
        // so the launcher only goes where there's a real run of text to flag.
        const textLines = flaggable.filter((el) => !el.closest("[data-solver]"));
        if (textLines.length < MIN_LINES_FOR_LAUNCHER) return;

        launcher = document.createElement("button");
        launcher.type = "button";
        launcher.className = "gfb-launcher";
        launcher.setAttribute("aria-label", "Flag a problem with a line");
        launcher.textContent = "⚑";
        launcher.addEventListener("click", startPicking);
        document.body.appendChild(launcher);

        banner.className = "gfb-pick-banner";
        banner.setAttribute("role", "status");
        banner.innerHTML =
            "<span>Tap the line with the problem</span>" +
            '<button type="button" class="gfb-pick-banner__close" aria-label="Stop flagging">✕</button>';
        banner.querySelector("button")?.addEventListener("click", stopPicking);
        document.body.appendChild(banner);

        // Out of the way until the reader has passed the contents list.
        const contents = document.querySelector(".quick-links-container");
        if (contents) {
            pastContents = false;
            new IntersectionObserver(([entry]) => {
                pastContents = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
                syncFlagMode();
            }).observe(contents);
        }
        syncFlagMode();
    }
    if (isSheet) setUpFlagMode();

    /**
     * Fired once per solver by react-solvers/src/main.tsx, right after hydrate().
     * Per container rather than per page, so a page mounting five solvers
     * decorates each as it lands instead of waiting for the slowest.
     *
     * If a chunk never loads, those lines just stay undecorated.
     */
    document.addEventListener("solver:hydrated", (e) => {
        const root = (e as CustomEvent<{ element?: HTMLElement }>).detail?.element;
        if (!root) return;
        // Same scoping as the selector above: only lines inside a .content-container
        // are flaggable, and some solver roots are one while others sit inside one.
        root.querySelectorAll<HTMLElement>("p, li:not(.dummy-li)").forEach((el) => {
            if (el.closest(".content-container")) decorate(el);
        });
        addSolverReportButton(root);
    });

    /**
     * The solver's own affordance: always visible, unlike the hover-reveal ⚑,
     * because it's the only way to report the thing solvers actually get wrong
     * and a hidden control gets a shrug and a one-line "it was wrong" instead.
     *
     * Appended INSIDE .solver-container, as its last child.
     *
     * The mount root is full-width while the card inside it is `width:
     * fit-content` and, on a solver-only page, centred — so a bar parked on the
     * root right-aligns to the root's edge and lands far from the solver it
     * belongs to. As a child of the card it inherits the card's width and the
     * card's position in every layout variant, with nothing to measure.
     *
     * Preact tolerates a trailing foreign child here: it sweeps unrecognised children
     * only while hydrating, which has finished by the time this runs.
     *
     * Never inside .solver-output, though: several solvers force that element to
     * remount via a changing key= on every recalculation.
     */
    function addSolverReportButton(root: HTMLElement): void {
        if (root.querySelector(".gfb-solver-bar")) return; // already done
        const card = root.querySelector<HTMLElement>(".solver-container") ?? root;

        const bar = document.createElement("div");
        bar.className = "gfb-solver-bar";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gfb-solver-flag";
        btn.textContent = "⚑ Report a problem with this solver";
        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!pop.hidden && activeTarget === root) {
                closePop();
                return;
            }
            openSolverPop(btn, root);
        });

        bar.appendChild(btn);
        card.appendChild(bar);
    }

    // ---- Auto-note: ask which lines crossed the buggy threshold, warn on them ----
    fetch("/api/feedback?path=" + encodeURIComponent(path))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { buggy?: Array<{ line_hash?: string }> }) => {
            if (!data.buggy || data.buggy.length === 0) return;
            const buggy = new Set(
                data.buggy.map((b) => b.line_hash).filter((h): h is string => typeof h === "string"),
            );
            if (buggy.size === 0) return;
            buggyHashes = buggy;
            for (const el of flaggable) maybeInjectBuggyNote(el);
        })
        .catch((err) => {
            // Endpoint unreachable (e.g. eleventy dev server) — no notes, no noise.
            log("warn", "[line-flagger] buggy-note check skipped:", err);
        });

    /** Insert the caution note: inside an <li> (as first child) or before a <p>. */
    function injectBuggyNote(el: HTMLElement): void {
        const note = document.createElement("div");
        note.className = "gfb-buggy-note";
        note.innerHTML =
            "⚠ <span><strong>Heads up:</strong> several readers report this step may be buggy.</span>";
        if (el.matches("li")) {
            el.insertBefore(note, el.firstChild);
        } else {
            el.parentNode?.insertBefore(note, el);
        }
    }

    /**
     * Normalized visible text of a line — its OWN text only. Text inside a nested
     * list/table/paragraph (each its own flaggable line) plus injected chrome (the
     * ⚑ button and any buggy-note) are excluded, so a list item that introduces a
     * sublist hashes and quotes by its own wording. For a leaf line with no nested
     * block this equals its full text, so existing line ids stay stable.
     */
    function lineText(el: HTMLElement): string {
        let out = "";
        el.childNodes.forEach((n) => {
            if (n.nodeType === Node.TEXT_NODE) {
                out += n.nodeValue ?? "";
                return;
            }
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            const e = n as Element;
            if (e.matches(NOT_OWN_TEXT)) return;
            out += e.textContent ?? "";
        });
        return out.replace(/⚑/g, "").replace(/\s+/g, " ").trim();
    }

    /** FNV-1a (32-bit), hex. The server accepts any [a-f0-9] line_hash. */
    function fnv1a(text: string): string {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ("0000000" + h.toString(16)).slice(-8);
    }

    /** Stable id for a line: FNV-1a of its normalized, lowercased text. */
    function lineId(el: HTMLElement): string {
        return fnv1a(lineText(el).toLowerCase());
    }

    // ---- Solver state harvesting ----------------------------------------------

    /**
     * Collapse whitespace, and drop the ⚑ glyph: solver paragraphs are flaggable
     * lines too, so this script's own affordance sits inside the very text being
     * harvested. lineText() strips it for the same reason.
     */
    function norm(s: string | null | undefined): string {
        return (s ?? "").replace(/⚑/g, "").replace(/\s+/g, " ").trim();
    }

    function asLabel(s: string | null | undefined): string {
        return norm(s).replace(/[:：]\s*$/, "");
    }
    function clampVal(s: string): string {
        return s.length > SNAP_MAX_VALUE ? s.slice(0, SNAP_MAX_VALUE - 1) + "…" : s;
    }

    /** Best available human name for an arbitrary element. */
    function elementLabel(el: HTMLElement): string {
        return (
            asLabel(el.getAttribute("aria-label")) ||
            asLabel(el.getAttribute("title")) ||
            asLabel(el.textContent) ||
            el.id ||
            el.tagName.toLowerCase()
        );
    }

    /**
     * Label for a form control, in descending order of how much the author meant
     * it: the control's own <label>, an aria-label, the label of the row it sits
     * in, then progressively weaker fallbacks.
     *
     * `.labels` rather than a `label[for="…"]` query: it covers both an explicit
     * for= and a wrapping <label> in one go, and needs no selector built out of an
     * id — which would otherwise mean CSS.escape, a global that is not guaranteed
     * to exist and, when it doesn't, throws from inside the harvest and takes the
     * whole report down with it.
     */
    function controlLabel(el: HTMLElement): string {
        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length) {
            const t = asLabel(labels[0].textContent);
            if (t) return t;
        }
        const aria = asLabel(el.getAttribute("aria-label"));
        if (aria) return aria;

        const row = el.closest(".solver-form-row, .solver-controls");
        const rowLabel = asLabel(row?.querySelector("label")?.textContent);
        if (rowLabel) return rowLabel;

        return (
            asLabel(el.getAttribute("placeholder")) ||
            el.getAttribute("name") ||
            el.id ||
            "field"
        );
    }

    /** Readable value of a form control — option TEXT, not the option's value. */
    function controlValue(el: HTMLElement): string {
        if (el instanceof HTMLSelectElement) {
            const picked = Array.from(el.selectedOptions).map((o) => norm(o.textContent) || o.value);
            return picked.length ? picked.join(", ") : "(none)";
        }
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
            return el.checked ? "checked" : "unchecked";
        }
        const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
        return norm(v) === "" ? "(blank)" : norm(v);
    }

    /** Which option(s) of a radiogroup are on, by their labels. */
    function groupValue(g: HTMLElement): string {
        const on = Array.from(g.querySelectorAll<HTMLElement>(CELL_ON_SEL));
        if (on.length === 0) return "(none)";
        return on.map(elementLabel).join(" + ");
    }

    /**
     * Slots already describe themselves: every solver builds them with an
     * aria-label like "Slot 1: WOLF, click to clear". Strip the instruction half
     * and the slot list reads back as the sequence the user picked.
     */
    function slotListValue(list: HTMLElement): string {
        const slots = Array.from(
            list.querySelectorAll<HTMLElement>('.solver-slot, [role="listitem"]'),
        );
        if (slots.length === 0) return "(empty)";
        return slots
            .map((s) => elementLabel(s).replace(/,\s*(click|tap)\b.*$/i, ""))
            .join(" | ");
    }

    /**
     * Grids are only summarized by which cells are marked. A board's full state
     * generally isn't in the DOM, so listing the "on" cells is the honest limit of
     * what a generic harvest can claim to know.
     */
    function gridValue(g: HTMLElement): string {
        const on = Array.from(g.querySelectorAll<HTMLElement>(CELL_ON_SEL));
        if (on.length === 0) return "(no cells marked)";
        const shown = on.slice(0, 24).map(elementLabel);
        if (on.length > shown.length) shown.push(`…+${on.length - shown.length} more`);
        return shown.join(", ");
    }

    /**
     * The reader's inputs for this solver.
     *
     * The solver's own report is the only source that knows what was ENTERED as
     * opposed to what happens to be rendered, so it wins whenever it exists — for
     * the grid and canvas solvers it's the only source at all. The DOM scrape is
     * the fallback for a solver that hasn't published its inputs (a new one, say),
     * and marks itself as such so a thin report isn't mistaken for a thin input.
     */
    function captureSolver(root: HTMLElement, solver: string): SolverSnapshot {
        const reported = window.SolverReport?.read(root) ?? null;
        const snap: SolverSnapshot = reported
            ? { v: 2, solver: reported.name || solver, state: reported.inputs }
            : { v: 2, solver, state: scrapeSolverInputs(root), scraped: true };

        const build = document
            .querySelector<HTMLMetaElement>('meta[name="build"]')
            ?.content?.trim();
        if (build) snap.build = build.slice(0, 32);

        snap.vp = `${window.innerWidth}x${window.innerHeight}`;

        return snap;
    }

    /**
     * Fallback: whatever the solver root exposes about its inputs, in DOM order.
     *
     * Generic by design — it reads the markup conventions the solvers share
     * (labelled controls, radiogroups, self-describing slots) and nothing
     * solver-specific. It captures no output and no error text: those are derived
     * from the inputs and recomputing them is free, so storing them would only add
     * noise to a report.
     */
    function scrapeSolverInputs(root: HTMLElement): Record<string, string> {
        const container = root.querySelector<HTMLElement>(".solver-container") ?? root;
        const state: Record<string, string> = {};
        let keyCount = 0;

        const put = (rawKey: string, rawValue: string): void => {
            if (keyCount >= SNAP_MAX_KEYS) return;
            const value = clampVal(norm(rawValue));
            if (!value) return;
            let key = norm(rawKey).slice(0, SNAP_MAX_KEY) || "field";
            // Repeated labels are common (four rows all labelled "Symbol"), and
            // silently overwriting would drop three of them.
            if (key in state) {
                let n = 2;
                while (`${key} (${n})` in state) n++;
                key = `${key} (${n})`;
            }
            state[key] = value;
            keyCount++;
        };

        // Subtrees already summarized as a single entry; anything inside one is
        // skipped so a radiogroup isn't also reported button by button.
        const consumed: Element[] = [];
        const toggles: string[] = [];

        for (const el of Array.from(container.querySelectorAll<HTMLElement>(HARVEST_SEL))) {
            if (el.closest(".gfb-solver-bar")) continue; // our own button
            if (consumed.some((c) => c.contains(el))) continue;

            if (el.matches('[role="radiogroup"]')) {
                put(asLabel(el.getAttribute("aria-label")) || "Choice", groupValue(el));
                consumed.push(el);
            } else if (el.matches(".solver-slot-list")) {
                put(asLabel(el.getAttribute("aria-label")) || "Slots", slotListValue(el));
                consumed.push(el);
            } else if (el.matches(".solver-grid, .queens-board")) {
                put(asLabel(el.getAttribute("aria-label")) || "Grid", gridValue(el));
                consumed.push(el);
            } else if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
                if (el instanceof HTMLInputElement && /^(hidden|button|submit|reset|image|file)$/.test(el.type)) continue;
                put(controlLabel(el), controlValue(el));
            } else {
                // A pressed/active button outside any group — a mode or step
                // toggle. Gathered into one entry rather than one key each, which
                // would collide on label and read as noise.
                const label = elementLabel(el);
                if (label && !toggles.includes(label)) toggles.push(label);
            }
        }
        if (toggles.length) put("Active buttons", toggles.join(", "));

        // Say so rather than imply the capture is complete: a canvas cannot be
        // read from the DOM at all, and a solver drawing to one that reaches this
        // fallback has reported nothing about its board.
        if (container.querySelector("canvas")) {
            put("(canvas)", "this solver draws to a canvas, so its board was not captured");
        }

        return state;
    }

    /**
     * An input value as one line of readable text.
     *
     * Nested arrays keep their brackets while a top-level one doesn't, because the
     * bracket is what separates the members of a list of coordinates: a board
     * reads as "[0, 0], [1, 3]" and stays unambiguous, while a flat list of
     * colours reads as "red, black, white" and gains nothing from them.
     */
    function formatValue(value: unknown): string {
        if (value === null || value === undefined) return "(none)";
        if (typeof value === "boolean") return value ? "yes" : "no";
        if (typeof value === "number") return String(value);
        if (typeof value === "string") return value === "" ? "(blank)" : value;
        if (Array.isArray(value)) {
            if (value.length === 0) return "(none)";
            return value
                .map((v) => (Array.isArray(v) ? `[${v.map(formatValue).join(", ")}]` : formatValue(v)))
                .join(", ");
        }
        try {
            // A nested object has no natural prose form; JSON is the honest one.
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    /**
     * Stable string form of a JSON value: object keys sorted at every level, so
     * two reports of the same inputs hash alike even if a solver reorders the keys
     * it publishes between builds.
     */
    function canonicalJson(value: unknown): string {
        if (value === null || typeof value !== "object") {
            return JSON.stringify(value) ?? "null";
        }
        if (Array.isArray(value)) {
            return "[" + value.map(canonicalJson).join(",") + "]";
        }
        const obj = value as Record<string, unknown>;
        return (
            "{" +
            Object.keys(obj)
                .sort()
                .map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]))
                .join(",") +
            "}"
        );
    }

    /**
     * Identity of a solver report: the solver plus the exact inputs behind it. No
     * output goes in, because none is stored — and none is needed, since inputs
     * determine it.
     */
    function snapshotHash(snap: SolverSnapshot): string {
        return fnv1a(`${snap.solver}|${canonicalJson(snap.state)}`);
    }

    /** One-line form, used as the flag's quote so admin and Telegram read well. */
    function snapshotSummary(snap: SolverSnapshot): string {
        const fields = Object.entries(snap.state)
            .map(([k, v]) => `${k}=${formatValue(v)}`)
            .join(", ");
        const full = fields ? `${snap.solver} · ${fields}` : `${snap.solver} · (nothing entered)`;
        return full.length > 300 ? full.slice(0, 299) + "…" : full;
    }

    /**
     * JSON for the wire, shrunk to fit the cap by dropping trailing state entries
     * rather than by truncating the string — a truncated JSON string is not JSON,
     * and the server would reject the whole report over a field nobody needed.
     */
    function serializeSnapshot(snap: SolverSnapshot): string {
        let out = JSON.stringify(snap);
        if (out.length <= SNAP_MAX_CHARS) return out;

        const trimmed: SolverSnapshot = { ...snap, state: { ...snap.state } };
        const keys = Object.keys(trimmed.state);
        while (keys.length && out.length > SNAP_MAX_CHARS) {
            delete trimmed.state[keys.pop()!];
            trimmed.state["(truncated)"] = "some fields were too large to send";
            out = JSON.stringify(trimmed);
        }
        return out.length <= SNAP_MAX_CHARS
            ? out
            : JSON.stringify({ v: 2, solver: snap.solver, state: {} } satisfies SolverSnapshot);
    }

    /** True on the local dev server, where no /api/feedback Functions exist. */
    function isLocalHost(): boolean {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    }

    /** Mirror the server's normalization: leading slash, no trailing slash (except root). */
    function normalizePath(p: string): string {
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p;
    }
});
