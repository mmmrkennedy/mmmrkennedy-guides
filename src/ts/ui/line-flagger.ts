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
 * Network: like view-counter.ts, the eleventy dev server has no Functions, so a
 * failed call on localhost is treated as a silent demo no-op rather than a
 * user-facing error. Under `wrangler pages dev` and in production the real
 * endpoints are hit.
 */
type FeedbackReason = "unclear" | "outdated" | "wrong" | "buggy";

/**
 * Blocks nested inside a line that are lines of their own: they're excluded from
 * the line's text, and the ⚑ goes before the first of them rather than after the
 * whole subtree. `.table-scroll` is the wrapper the build puts around every
 * <table> (wrapTables in eleventy.config.cjs), so a bare `table` never actually
 * appears as a child here — without the wrapper in this list a list item that
 * introduces a table swallowed the entire table's text into its hash and quote,
 * and parked its flag below the table.
 */
const NESTED_BLOCK = "ul, ol, table, p, .table-scroll";
/** Same set, matched only as a direct child. */
const NESTED_BLOCK_CHILD = NESTED_BLOCK.split(", ")
    .map((sel) => ":scope > " + sel)
    .join(", ");
/** Nested blocks plus the chrome this script injects — all skipped by lineText(). */
const NOT_OWN_TEXT = NESTED_BLOCK + ", .gfb-flag, .gfb-buggy-note";

document.addEventListener("DOMContentLoaded", () => {
    // Pages can opt out (e.g. the home/index page) via <body data-no-flags>.
    if (document.body.hasAttribute("data-no-flags")) return;

    const lines = document.querySelectorAll<HTMLElement>(
        ".content-container p, .content-container li",
    );
    if (lines.length === 0) return;

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
        '<div class="gfb-pop__reasons">' +
            '<button type="button" class="gfb-reason" data-reason="unclear" aria-pressed="false">Doesn’t make sense</button>' +
            '<button type="button" class="gfb-reason" data-reason="outdated" aria-pressed="false">Out of date</button>' +
            '<button type="button" class="gfb-reason" data-reason="wrong" aria-pressed="false">Incorrect</button>' +
            '<button type="button" class="gfb-reason" data-reason="buggy" aria-pressed="false">Doesn’t work / buggy</button>' +
        "</div>" +
        '<textarea placeholder="Briefly, what’s wrong with this line? (required)"></textarea>' +
        '<p class="gfb-pop__hint">Pick a reason and add at least a few words so we can act on it.</p>' +
        '<div class="gfb-pop__actions">' +
            '<button type="button" class="gfb-pop__btn gfb-pop__cancel">Cancel</button>' +
            '<button type="button" class="gfb-pop__btn gfb-pop__btn--send gfb-pop__send" disabled>Send</button>' +
        "</div>";
    document.body.appendChild(pop);

    const quoteEl = pop.querySelector<HTMLElement>(".gfb-pop__quote")!;
    const textarea = pop.querySelector<HTMLTextAreaElement>("textarea")!;
    const reasonBtns = pop.querySelectorAll<HTMLButtonElement>(".gfb-reason");
    const hintEl = pop.querySelector<HTMLElement>(".gfb-pop__hint")!;
    const sendBtn = pop.querySelector<HTMLButtonElement>(".gfb-pop__send")!;
    const cancelBtn = pop.querySelector<HTMLButtonElement>(".gfb-pop__cancel")!;

    let activeTarget: HTMLElement | null = null;
    let activeQuote = "";
    let sending = false;
    const MIN_DETAIL = 4; // anti low-effort: must be MORE than 3 characters
    const DEFAULT_HINT = "Pick a reason and add at least a few words so we can act on it.";

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

    reasonBtns.forEach((rb) => {
        rb.addEventListener("click", () => {
            reasonBtns.forEach((o) => o.setAttribute("aria-pressed", String(o === rb)));
            refresh();
        });
    });
    textarea.addEventListener("input", refresh);

    function resetForm(): void {
        reasonBtns.forEach((o) => o.setAttribute("aria-pressed", "false"));
        textarea.value = "";
        hintEl.textContent = DEFAULT_HINT;
        hintEl.classList.remove("is-error");
        sending = false;
        sendBtn.disabled = true;
        sendBtn.textContent = "Send";
    }
    function closePop(): void {
        pop.hidden = true;
        activeTarget = null;
        resetForm();
    }

    function openPop(flagBtn: HTMLElement, target: HTMLElement): void {
        activeTarget = target;
        resetForm();
        activeQuote = lineText(target);
        quoteEl.textContent = activeQuote.length > 90 ? activeQuote.slice(0, 90) + "…" : activeQuote;
        pop.hidden = false;
        // Position under the flag, clamped to the viewport; flip above if it would
        // overflow the bottom.
        const r = flagBtn.getBoundingClientRect();
        const pw = pop.offsetWidth;
        const ph = pop.offsetHeight;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
        let top = r.bottom + 6;
        if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
        pop.style.left = left + "px";
        pop.style.top = top + "px";
    }

    cancelBtn.addEventListener("click", closePop);
    sendBtn.addEventListener("click", () => {
        const reason = selectedReason();
        if (sending || reason === null || !detailOk()) {
            hintEl.textContent = "Please pick a reason and add at least 4 meaningful characters.";
            hintEl.classList.add("is-error");
            return;
        }
        void sendFlag(reason);
    });

    async function sendFlag(reason: FeedbackReason): Promise<void> {
        if (!activeTarget) return;
        const target = activeTarget;
        const payload = {
            path,
            line_hash: target.dataset.lineId ?? "",
            quote: activeQuote,
            reason,
            detail: textarea.value.trim(),
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
            target.classList.add("gfb-flagged");
            closePop();
            showToast("🚩 Thanks — flagged for review");
        } catch (err) {
            if (isLocalHost()) {
                // No Functions on the eleventy dev server: behave like the demo.
                console.warn("[line-flagger] no backend on localhost; would POST", payload);
                target.classList.add("gfb-flagged");
                closePop();
                showToast("🚩 Thanks — flagged for review (local demo)");
            } else {
                console.warn("Flag submission failed:", err);
                sending = false;
                sendBtn.textContent = "Send";
                sendBtn.disabled = false;
                hintEl.textContent = "Couldn’t send — please try again.";
                hintEl.classList.add("is-error");
            }
        }
    }

    document.addEventListener("click", (e) => {
        const t = e.target as Node | null;
        if (pop.hidden || (t && pop.contains(t))) return;
        if (t instanceof Element && t.classList.contains("gfb-flag")) return;
        closePop();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePop();
    });
    window.addEventListener("resize", closePop);
    window.addEventListener("scroll", closePop, true);

    // ---- Attach a ⚑ + stable id to each leaf paragraph / bullet ----
    const flaggable: HTMLElement[] = [];
    lines.forEach((el) => {
        // Flaggable when the line has its own text. lineText() excludes any
        // nested list/table/paragraph (each its own flaggable line), so an <li>
        // that introduces a sublist (e.g. "Wait for X to spawn." + <ul>) is still
        // flaggable by its own wording, while a pure grouping <li> is skipped.
        if (!lineText(el)) return;
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
    });

    // ---- Auto-note: ask which lines crossed the buggy threshold, warn on them ----
    fetch("/api/feedback?path=" + encodeURIComponent(path))
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { buggy?: Array<{ line_hash?: string }> }) => {
            if (!data.buggy || data.buggy.length === 0) return;
            const buggy = new Set(
                data.buggy.map((b) => b.line_hash).filter((h): h is string => typeof h === "string"),
            );
            if (buggy.size === 0) return;
            for (const el of flaggable) {
                if (!buggy.has(el.dataset.lineId ?? "")) continue;
                if (el.previousElementSibling?.classList.contains("gfb-buggy-note")) continue;
                if (el.firstElementChild?.classList.contains("gfb-buggy-note")) continue;
                injectBuggyNote(el);
            }
        })
        .catch((err) => {
            // Endpoint unreachable (e.g. eleventy dev server) — no notes, no noise.
            console.warn("[line-flagger] buggy-note check skipped:", err);
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

    /** Stable id for a line: FNV-1a (32-bit) of its normalized, lowercased text. */
    function lineId(el: HTMLElement): string {
        const text = lineText(el).toLowerCase();
        let h = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            h ^= text.charCodeAt(i);
            h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
        }
        return ("0000000" + h.toString(16)).slice(-8);
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
