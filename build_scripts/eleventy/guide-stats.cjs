/**
 * Splits the one-line stats paragraph into labelled items so CSS can lay them
 * out as columns instead of a run of " | " and " - ":
 *
 *   <p class="stats">Stats (Solo): Difficulty - 7/10 | Est. Completion Time - 1 Hr | RNG Rating - 1/5 (Box)</p>
 *
 * The separators stay in the markup as hidden .stats__sep spans, so the
 * paragraph's text is unchanged. line-flagger.ts hashes that text into the line
 * id, and guide_commit_check.py reads the source line, so both keep working.
 * A line that doesn't fit the pattern is left as plain text.
 */

const HEAD_RE = /^(Stats(?:\s*\([^)]*\))?)(:\s*)([\s\S]+)$/;
const ITEM_RE = /^(.+?)(\s+-\s+)(.+)$/;
// A trailing "(...)" is a qualifier on the value, shown on its own line.
const NOTE_RE = /^(.*?)(\s*)\((.+)\)$/;

function span(document, className, text) {
    const el = document.createElement("span");
    el.className = className;
    el.textContent = text;
    return el;
}

function buildItem(document, raw) {
    const m = ITEM_RE.exec(raw);
    if (!m) return null;
    const [, label, dash, value] = m;

    const item = span(document, "stats__item", "");
    item.append(span(document, "stats__label", label), span(document, "stats__sep", dash));

    const note = NOTE_RE.exec(value);
    if (note && note[1]) {
        const [, main, gap, inner] = note;
        const noteEl = span(document, "stats__note", "");
        noteEl.append(span(document, "stats__sep", `${gap}(`), inner, span(document, "stats__sep", ")"));
        item.append(span(document, "stats__value", main), noteEl);
    } else {
        item.append(span(document, "stats__value", value));
    }
    return item;
}

const normalise = (s) => s.replace(/\s+/g, " ").trim();

function formatGuideStats(document) {
    let touched = false;

    for (const p of document.querySelectorAll("p.stats")) {
        if (p.children.length > 0) continue;
        const original = p.textContent.trim();

        const head = HEAD_RE.exec(original);
        if (!head) continue;
        const [, title, colon, rest] = head;

        const rawItems = rest.split(/(\s+\|\s+)/);
        const frag = document.createDocumentFragment();
        frag.append(span(document, "stats__title", title), span(document, "stats__sep", colon));

        let ok = true;
        for (const [i, raw] of rawItems.entries()) {
            if (i % 2 === 1) {
                frag.append(span(document, "stats__sep", raw));
                continue;
            }
            const item = buildItem(document, raw);
            if (!item) {
                ok = false;
                break;
            }
            frag.append(item);
        }
        if (!ok) continue;

        const probe = document.createElement("p");
        probe.append(frag.cloneNode(true));
        if (normalise(probe.textContent) !== normalise(original)) continue;

        p.textContent = "";
        p.append(frag);
        p.classList.add("is-split");
        touched = true;
    }

    return touched;
}

module.exports = { formatGuideStats };
