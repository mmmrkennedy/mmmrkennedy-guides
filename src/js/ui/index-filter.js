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
    // --- Completion tally ----------------------------------------------------
    // Counted from the list itself so it can never drift from the links: every
    // /games/ entry that isn't a `.solver-link` is one map, keyed by path so a
    // map listed under two games (Shangri-La under BO1 and BO3, the Zombies
    // Chronicles remasters) counts once. A map is complete unless every listing
    // of it is `.disabled` — and those carry data-href, not href, because the
    // build unlinks them (see `unlinkUnwrittenGuides` in eleventy.config.cjs).
    function renderProgress() {
        const box = document.querySelector("[data-index-progress]");
        if (!box)
            return;
        const maps = new Map(); // path -> complete
        container.querySelectorAll("a[href], a[data-href]").forEach((a) => {
            if (a.classList.contains("solver-link"))
                return;
            const target = a.getAttribute("href") ?? a.getAttribute("data-href") ?? "";
            const path = target.split(/[?#]/)[0].replace(/\/+$/, "");
            if (!path.startsWith("/games/"))
                return;
            const complete = !a.classList.contains("disabled");
            maps.set(path, (maps.get(path) ?? false) || complete);
        });
        const total = maps.size;
        if (total === 0)
            return;
        let done = 0;
        for (const complete of maps.values())
            if (complete)
                done++;
        // Clamp the rounding so a single missing map can never read as "100%".
        let pct = Math.round((done / total) * 100);
        if (pct === 100 && done < total)
            pct = 99;
        if (pct === 0 && done > 0)
            pct = 1;
        box.textContent = `${done} / ${total} Guides Complete · ${pct}%`;
        const left = total - done;
        box.title = left === 0 ? "Every map is covered" : `${left} still being written`;
        box.hidden = false;
    }
    renderProgress();
    // --- "Not written yet" tap hint ------------------------------------------
    // A map without a guide is a `.disabled` anchor the build has stripped the
    // href from, so clicking it does nothing at all. On a mouse the not-allowed
    // cursor says why, but touch has no hover — so a tap gets an explanation.
    // Reuses .gfb-toast from feedback.css; the line flagger (its other user) is
    // off on this page via <body data-no-flags>.
    const toast = document.createElement("div");
    toast.className = "gfb-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
    let toastTimer;
    container.addEventListener("click", (e) => {
        const dead = e.target?.closest("a.disabled");
        if (!dead)
            return;
        // Built as nodes rather than innerHTML so the map name stays text
        const name = document.createElement("strong");
        name.textContent = (dead.textContent ?? "").trim();
        if (name.textContent.startsWith("The ")) {
            toast.replaceChildren(name, " guide has not been written yet");
        }
        else {
            toast.replaceChildren("The ", name, " guide has not been written yet");
        }
        toast.classList.add("is-on");
        if (toastTimer)
            clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("is-on"), 2600);
    });
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
