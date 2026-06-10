"use strict";
/**
 * Home-page map finder
 * --------------------
 * The index lists every map grouped by game in one long page. Two affordances
 * make a map near the bottom reachable without a long scroll:
 *   1. a live text filter that hides non-matching entries (diacritic-insensitive,
 *      so "verruckt" matches "Verrückt" and "kowakujo" matches "Kowakujō"), and
 *   2. a row of game "chips" that jump to each game's section — offset by the
 *      sticky bar — with the current section highlighted as you scroll.
 *
 * Progressive enhancement: the full list works without this script; it only
 * activates when the .index-nav shell is present (home page only).
 */
document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("[data-index-nav]");
    const input = document.getElementById("index-filter");
    const chipsBox = nav?.querySelector(".index-nav__chips") ?? null;
    const clearBtn = nav?.querySelector(".index-nav__clear") ?? null;
    const emptyMsg = document.querySelector(".index-nav__empty");
    const contentWindow = document.querySelector(".content-window");
    const container = document.querySelector(".content-container");
    if (!nav || !input || !chipsBox || !container)
        return;
    // Friendly, compact chip labels keyed by the <h2> id. Falls back to the id.
    const LABELS = {
        BO7: "BO7", BO6: "BO6", VG: "Vanguard", BO_CW: "Cold War",
        BO4: "BO4", WW2: "WW2", IW: "IW", BO3: "BO3",
        AW: "AW", BO2: "BO2", BO1: "BO1", WAW: "WAW",
    };
    function buildChip(id, label) {
        const a = document.createElement("a");
        a.className = "index-nav__chip";
        a.href = "#" + id;
        a.textContent = label;
        a.dataset.target = id;
        return a;
    }
    // Pair each game <h2 id> with the <ul> that follows it, and build its chip.
    const groups = [];
    container.querySelectorAll("h2[id]").forEach((heading) => {
        let list = heading.nextElementSibling;
        while (list && list.tagName !== "UL")
            list = list.nextElementSibling;
        if (!list)
            return;
        const items = Array.from(list.children).filter((c) => c.tagName === "LI");
        const chip = buildChip(heading.id, LABELS[heading.id] ?? heading.id);
        chipsBox.appendChild(chip);
        groups.push({ heading, list, items, chip });
    });
    if (groups.length === 0)
        return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // --- Jump chips ----------------------------------------------------------
    chipsBox.addEventListener("click", (e) => {
        const chip = e.target.closest(".index-nav__chip");
        if (!chip)
            return;
        e.preventDefault();
        e.stopPropagation(); // pre-empt the global anchor handler (it has no sticky-bar offset)
        const id = chip.dataset.target;
        if (id)
            scrollToSection(id);
    });
    function scrollToSection(id) {
        const el = document.getElementById(id);
        if (!el || !contentWindow)
            return;
        const offset = nav.getBoundingClientRect().height + 8;
        const top = el.getBoundingClientRect().top + contentWindow.scrollTop - offset;
        contentWindow.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
        history.pushState({ anchor: id }, "", "#" + id);
    }
    // --- Live filter ---------------------------------------------------------
    const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    // Fold each item's text once up front; the list never changes.
    const folded = new Map();
    for (const g of groups) {
        for (const li of g.items)
            folded.set(li, fold(li.textContent ?? ""));
    }
    function applyFilter(raw) {
        const q = fold(raw.trim());
        const filtering = q.length > 0;
        let anyVisible = false;
        for (const g of groups) {
            let groupVisible = false;
            for (const li of g.items) {
                const match = !filtering || (folded.get(li) ?? "").includes(q);
                li.classList.toggle("index-hidden", !match);
                if (match)
                    groupVisible = true;
            }
            g.heading.classList.toggle("index-hidden", filtering && !groupVisible);
            g.list.classList.toggle("index-hidden", filtering && !groupVisible);
            g.chip.classList.toggle("is-empty", filtering && !groupVisible);
            if (groupVisible)
                anyVisible = true;
        }
        if (clearBtn)
            clearBtn.hidden = !filtering;
        if (emptyMsg)
            emptyMsg.hidden = !(filtering && !anyVisible);
    }
    input.addEventListener("input", () => applyFilter(input.value));
    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && input.value) {
            e.preventDefault();
            input.value = "";
            applyFilter("");
        }
    });
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            input.value = "";
            applyFilter("");
            input.focus();
        });
    }
    // "/" focuses the filter from anywhere, unless already typing in a field.
    document.addEventListener("keydown", (e) => {
        if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey)
            return;
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
            return;
        e.preventDefault();
        input.focus();
    });
    // --- Scroll-spy: highlight the chip for the section nearest the top -------
    if (contentWindow && "IntersectionObserver" in window) {
        const visible = new Set();
        const io = new IntersectionObserver((entries) => {
            for (const en of entries) {
                const id = en.target.id;
                if (en.isIntersecting)
                    visible.add(id);
                else
                    visible.delete(id);
            }
            let activeId = null;
            for (const g of groups) {
                if (visible.has(g.heading.id)) {
                    activeId = g.heading.id;
                    break;
                }
            }
            for (const g of groups) {
                const isActive = g.heading.id === activeId;
                g.chip.classList.toggle("is-active", isActive);
                if (isActive)
                    g.chip.setAttribute("aria-current", "true");
                else
                    g.chip.removeAttribute("aria-current");
            }
        }, {
            root: contentWindow,
            // Only treat a heading as "current" while it sits in the band just
            // below the sticky bar and the top ~30% of the viewport.
            rootMargin: `-${Math.round(nav.getBoundingClientRect().height)}px 0px -70% 0px`,
            threshold: 0,
        });
        for (const g of groups)
            io.observe(g.heading);
    }
});
