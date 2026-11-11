import { log } from "../core/logger";

/**
 * data-line-id is an FNV-1a hash of the line's normalized text, so editing a
 * line retires its flags. Failed calls on localhost are a silent no-op.
 */
type FeedbackReason = "unclear" | "outdated" | "wrong" | "buggy";

const LINE_REASONS: ReadonlyArray<readonly [FeedbackReason, string]> = [
    ["unclear", "Doesn’t make sense"],
    ["outdated", "Out of date"],
    ["wrong", "Incorrect"],
    ["buggy", "Doesn’t work / buggy"],
];

/** 'wrong' leads: it's what a solver report almost always is. */
const SOLVER_REASONS: ReadonlyArray<readonly [FeedbackReason, string]> = [
    ["wrong", "Gives the wrong answer"],
    ["buggy", "Broken / errors out"],
    ["unclear", "Confusing to use"],
    ["outdated", "Out of date"],
];

interface SolverSnapshot {
    /** Schema version, so a shape change is detectable in the admin UI. */
    v: 2;
    solver: string;
    /** Reader's inputs only, never anything the solver computed from them. */
    state: Record<string, unknown>;
    /** Came from the DOM fallback rather than window.SolverReport. */
    scraped?: true;
    build?: string;
    vp?: string;
}

/* The server enforces its own caps too. */
const SNAP_MAX_KEYS = 60;
const SNAP_MAX_KEY = 60;
const SNAP_MAX_VALUE = 200;
/** Under the server's 8192, measured in UTF-16 code units as the server does. */
const SNAP_MAX_CHARS = 7800;

/** Container matches summarize their whole subtree as one entry. */
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

const CELL_ON_SEL =
    '[aria-pressed="true"], [aria-checked="true"], .is-on, .is-selected, .is-filled, .is-active';

/**
 * Nested blocks are lines of their own, excluded from the parent's text.
 * `.table-scroll` is the wrapper prepareTables (build_scripts/eleventy/tables.cjs)
 * puts around every <table>.
 */
const NESTED_BLOCK = "ul, ol, table, p, h3, h4, .table-scroll";
const NOT_OWN_TEXT = NESTED_BLOCK + ", .gfb-buggy-note";
/** Below this the page is a solver or a stub. */
const MIN_LINES_FOR_LAUNCHER = 5;

document.addEventListener("DOMContentLoaded", () => {
    if (document.body.hasAttribute("data-no-flags")) return;

    const lines = document.querySelectorAll<HTMLElement>(
        ".content-container p, .content-container :is(.title-tier-2, .title-tier-3, .title-tier-4), .content-container li:not(.dummy-li)"
    );

    // Without an SSR build a solver page can have no lines yet. Stay if a solver is
    // going to arrive, or the solver:hydrated listener below never registers.
    const solverIncoming = document.querySelector("[data-solver]") !== null;
    if (lines.length === 0 && !solverIncoming) return;

    const path = normalizePath(window.location.pathname);

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
    let pickedMarks: HTMLElement[] = [];
    let picking = false;
    /** Replaced by setUpFlagMode. */
    let syncFlagMode = (): void => {};
    /** Non-null in solver mode. */
    let activeSnapshot: SolverSnapshot | null = null;
    let reasonBtns: HTMLButtonElement[] = [];

    const MIN_DETAIL = 4;
    const DEFAULT_HINT = "Pick a reason and add at least a few words so we can act on it.";

    /** Solver mode hides the hint line, so an error has to unhide it. */
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
        // Rejects a single repeated character ("aaaa", "....").
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
        clearPickedMarks();
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
    window.visualViewport?.addEventListener("resize", fitSheet);
    window.visualViewport?.addEventListener("scroll", fitSheet);

    function openPop(target: HTMLElement): void {
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
        fitSheet();
        syncFlagMode();
    }

    /** Snapshot is taken at open, not send, so the popover shows exactly what gets sent. */
    function openSolverPop(root: HTMLElement): void {
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
        textarea.placeholder = "What happened? (required)";
        expectedWrap.hidden = false;
        hintEl.hidden = true;
        activeQuote = snapshotSummary(activeSnapshot);
        quoteEl.hidden = true;
        renderSnapshot(activeSnapshot);
        snapEl.hidden = false;
        snapEl.open = false;
        pop.hidden = false;
        fitSheet();
        syncFlagMode();
    }

    /** Verbatim, so nothing is sent behind the reader's back. */
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
            // A solver hashes its inputs instead, so re-reports of the same inputs
            // dedupe on UNIQUE (line_hash, ip_hash, reason) and distinct IPs per
            // hash count people hitting that exact input.
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

        const markSent = (): void => {
            if (snap) {
                target.classList.add("gfb-solver-flagged");
                return;
            }
            for (const mark of pickedMarks) mark.className = "gfb-sent";
            pickedMarks = [];
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
                // No Functions on the eleventy dev server.
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

    // Stray clicks, scrolling and resizing must not throw away a half-typed note, so
    // the sheet only closes through Cancel, Send or Escape.
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        stopPicking();
        closePop();
    });

    const flaggable: HTMLElement[] = [];

    /**
     * Held rather than consumed: solver lines may be decorated after the fetch
     * resolves, and either order must end with the same notes.
     */
    let buggyHashes: Set<string> | null = null;

    function decorate(el: HTMLElement): void {
        // A pure grouping <li> has no own text and is skipped.
        if (!lineText(el)) return;
        if (el.classList.contains("gfb-flaggable")) return;
        el.classList.add("gfb-flaggable");
        el.dataset.lineId = lineId(el);
        flaggable.push(el);
        maybeInjectBuggyNote(el);
    }

    function maybeInjectBuggyNote(el: HTMLElement): void {
        if (!buggyHashes || !buggyHashes.has(el.dataset.lineId ?? "")) return;
        if (el.previousElementSibling?.classList.contains("gfb-buggy-note")) return;
        if (el.firstElementChild?.classList.contains("gfb-buggy-note")) return;
        injectBuggyNote(el);
    }

    // Hydration would undo changes to prerendered solver lines, so they wait for
    // solver:hydrated.
    for (const el of lines) {
        if (el.closest("[data-solver]")) continue;
        decorate(el);
    }

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
     * Capture phase, so a click on a link or image selects the line instead of
     * opening it. Tabs and disclosures pass through: the line may be inside one.
     */
    function pickLine(e: Event): void {
        const t = e.target;
        if (!(t instanceof Element) || t.closest(".gfb-pick-banner, .path-tabs__tab, summary")) return;
        e.preventDefault();
        e.stopPropagation();
        const line = lineAt(t);
        if (!line) return;
        stopPicking();
        pickedMarks = markOwnText(line);
        openPop(line);

        const barBottom = document.querySelector(".top-buttons-background-box")?.getBoundingClientRect().bottom ?? 0;
        const r = (pickedMarks[0] ?? line).getBoundingClientRect();
        if (r.top < barBottom + 8 || r.bottom > pop.getBoundingClientRect().top - 8) {
            window.scrollBy({ top: r.top - barBottom - 16, behavior: "auto" });
        }
    }

    /** Inside a table the tapped cell is the line. Cells get an id only when picked. */
    function lineAt(tapped: Element): HTMLElement | null {
        const line = tapped.closest<HTMLElement>(".gfb-flaggable");
        const table = tapped.closest("table, .table-scroll");
        if (!table || (line && !line.contains(table))) return line;
        const cell = tapped.closest("td");
        if (!cell || !lineText(cell)) return null;
        cell.dataset.lineId = lineId(cell);
        return cell;
    }

    /** Wraps own text rather than the box, which would also cover nested sublists and tables. */
    function markOwnText(line: HTMLElement): HTMLElement[] {
        const marks: HTMLElement[] = [];
        let run: ChildNode[] = [];
        const flush = (): void => {
            if (run.some((n) => (n.textContent ?? "").trim())) {
                const mark = document.createElement("span");
                mark.className = "gfb-picked";
                run[0].before(mark);
                mark.append(...run);
                marks.push(mark);
            }
            run = [];
        };
        for (const node of Array.from(line.childNodes)) {
            const isBlock =
                node instanceof Element &&
                (node.matches(NOT_OWN_TEXT) || !getComputedStyle(node).display.startsWith("inline"));
            if (isBlock) flush();
            else run.push(node);
        }
        flush();
        return marks;
    }

    function clearPickedMarks(): void {
        for (const mark of pickedMarks) mark.replaceWith(...Array.from(mark.childNodes));
        pickedMarks = [];
    }

    function setUpFlagMode(): void {
        let launcher: HTMLButtonElement | null = null;

        syncFlagMode = () => {
            const flagging = picking || !pop.hidden;
            document.body.classList.toggle("gfb-picking", picking);
            document.body.classList.toggle("gfb-flagging", flagging);
            banner.hidden = !picking;
            if (launcher) launcher.hidden = flagging;
        };

        // Solver pages already have the solver's own report button.
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
        // Some Android phones wrongly report hover support, hence the pointer check.
        const verb = window.matchMedia("(hover: none), (pointer: coarse)").matches ? "Tap" : "Click";
        banner.innerHTML =
            `<span>${verb} the line with the problem</span>` +
            '<button type="button" class="gfb-pick-banner__close" aria-label="Stop flagging">✕</button>';
        banner.querySelector("button")?.addEventListener("click", stopPicking);
        document.body.appendChild(banner);

        syncFlagMode();
    }
    setUpFlagMode();

    // Fired once per solver by react-solvers/src/main.tsx, right after hydrate().
    document.addEventListener("solver:hydrated", (e) => {
        const root = (e as CustomEvent<{ element?: HTMLElement }>).detail?.element;
        if (!root) return;
        // Some solver roots are a .content-container, others sit inside one.
        root.querySelectorAll<HTMLElement>("p, li:not(.dummy-li)").forEach((el) => {
            if (el.closest(".content-container")) decorate(el);
        });
        addSolverReportButton(root);
    });

    /**
     * Goes inside .solver-container, not the full-width mount root, so it takes the
     * fit-content card's width and position. Preact only sweeps foreign children
     * while hydrating, which is done by now. Never inside .solver-output: several
     * solvers remount it via a changing key=.
     */
    function addSolverReportButton(root: HTMLElement): void {
        if (root.querySelector(".gfb-solver-bar")) return;
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
            openSolverPop(root);
        });

        bar.appendChild(btn);
        card.appendChild(bar);
    }

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
            log("warn", "[line-flagger] buggy-note check skipped:", err);
        });

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
     * Own text only, excluding nested blocks and injected notes. For a leaf line
     * this equals its full text, so existing line ids stay stable.
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

    /** The server accepts any [a-f0-9] line_hash. */
    function fnv1a(text: string): string {
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ("0000000" + h.toString(16)).slice(-8);
    }

    function lineId(el: HTMLElement): string {
        return fnv1a(lineText(el).toLowerCase());
    }

    /** Drops the ⚑ that the injected report button carries. */
    function norm(s: string | null | undefined): string {
        return (s ?? "").replace(/⚑/g, "").replace(/\s+/g, " ").trim();
    }

    function asLabel(s: string | null | undefined): string {
        return norm(s).replace(/[:：]\s*$/, "");
    }
    function clampVal(s: string): string {
        return s.length > SNAP_MAX_VALUE ? s.slice(0, SNAP_MAX_VALUE - 1) + "…" : s;
    }

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
     * `.labels` rather than a `label[for="…"]` query: covers wrapping labels too, and
     * avoids CSS.escape, which may not exist and would throw mid-harvest.
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

    function groupValue(g: HTMLElement): string {
        const on = Array.from(g.querySelectorAll<HTMLElement>(CELL_ON_SEL));
        if (on.length === 0) return "(none)";
        return on.map(elementLabel).join(" + ");
    }

    /** Slot aria-labels look like "Slot 1: WOLF, click to clear"; the instruction half is stripped. */
    function slotListValue(list: HTMLElement): string {
        const slots = Array.from(
            list.querySelectorAll<HTMLElement>('.solver-slot, [role="listitem"]'),
        );
        if (slots.length === 0) return "(empty)";
        return slots
            .map((s) => elementLabel(s).replace(/,\s*(click|tap)\b.*$/i, ""))
            .join(" | ");
    }

    /** Marked cells only: a board's full state generally isn't in the DOM. */
    function gridValue(g: HTMLElement): string {
        const on = Array.from(g.querySelectorAll<HTMLElement>(CELL_ON_SEL));
        if (on.length === 0) return "(no cells marked)";
        const shown = on.slice(0, 24).map(elementLabel);
        if (on.length > shown.length) shown.push(`…+${on.length - shown.length} more`);
        return shown.join(", ");
    }

    /**
     * The solver's own report wins: only it knows what was entered rather than
     * rendered, and it's the only source for grid and canvas solvers.
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

    /** Inputs only, no output or error text: those are derived from the inputs. */
    function scrapeSolverInputs(root: HTMLElement): Record<string, string> {
        const container = root.querySelector<HTMLElement>(".solver-container") ?? root;
        const state: Record<string, string> = {};
        let keyCount = 0;

        const put = (rawKey: string, rawValue: string): void => {
            if (keyCount >= SNAP_MAX_KEYS) return;
            const value = clampVal(norm(rawValue));
            if (!value) return;
            let key = norm(rawKey).slice(0, SNAP_MAX_KEY) || "field";
            if (key in state) {
                let n = 2;
                while (`${key} (${n})` in state) n++;
                key = `${key} (${n})`;
            }
            state[key] = value;
            keyCount++;
        };

        const consumed: Element[] = [];
        const toggles: string[] = [];

        for (const el of Array.from(container.querySelectorAll<HTMLElement>(HARVEST_SEL))) {
            if (el.closest(".gfb-solver-bar")) continue;
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
                // Loose pressed buttons share one entry; one key each would collide on label.
                const label = elementLabel(el);
                if (label && !toggles.includes(label)) toggles.push(label);
            }
        }
        if (toggles.length) put("Active buttons", toggles.join(", "));

        if (container.querySelector("canvas")) {
            put("(canvas)", "this solver draws to a canvas, so its board was not captured");
        }

        return state;
    }

    /** Nested arrays keep brackets so coordinate lists read as "[0, 0], [1, 3]". */
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
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    /** Keys sorted at every level, so reordered keys between builds still hash alike. */
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

    function snapshotHash(snap: SolverSnapshot): string {
        return fnv1a(`${snap.solver}|${canonicalJson(snap.state)}`);
    }

    /** Used as the flag's quote in admin and Telegram. */
    function snapshotSummary(snap: SolverSnapshot): string {
        const fields = Object.entries(snap.state)
            .map(([k, v]) => `${k}=${formatValue(v)}`)
            .join(", ");
        const full = fields ? `${snap.solver} · ${fields}` : `${snap.solver} · (nothing entered)`;
        return full.length > 300 ? full.slice(0, 299) + "…" : full;
    }

    /** Drops trailing state entries rather than truncating: cut JSON would be rejected. */
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

    function isLocalHost(): boolean {
        const h = window.location.hostname;
        return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    }

    /** Mirrors the server's normalization. */
    function normalizePath(p: string): string {
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p;
    }
});
