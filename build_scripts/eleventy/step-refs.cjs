/**
 * Walks every <ol> on the page and records the number each named step renders
 * as, mirroring how the browser counts:
 *
 *  - only <li> that are *direct* children of the <ol> count, so the nested <ul>
 *    of picture links inside a step can't shift the numbering;
 *  - `.dummy-li` is skipped, because typography.css zeroes its counter-increment
 *    (those are the section headings sitting inside the list);
 *  - `start` on the <ol> and `value` on an <li> are honoured, same as the spec.
 */
function collectStepNumbers(document, outputPath) {
    const numbers = new Map();

    for (const list of document.querySelectorAll("ol")) {
        let n = Number(list.getAttribute("start")) || 1;

        for (const item of list.children) {
            if (item.tagName !== "LI") continue;
            if (item.classList.contains("dummy-li")) continue;

            const explicit = Number(item.getAttribute("value"));
            if (explicit) n = explicit;

            const name = item.getAttribute("data-step-id");
            if (name) {
                if (numbers.has(name)) {
                    console.warn(
                        `[resolveStepRefs] duplicate data-step-id "${name}" in ${outputPath}; using step ${n}.`,
                    );
                }
                numbers.set(name, n);
            }

            n += 1;
        }
    }

    return numbers;
}

/**
 * Resolves symbolic step references to the number the step actually renders as,
 * so a hand-written "Repeat Steps 11-13" can't desync when a step is inserted
 * above it.
 *
 * Authored form — the step being pointed at gets a name, and the reference
 * carries that name instead of a number:
 *
 *   <li data-step-id="charge-canister">Insert the canister into the harvester…</li>
 *   <li data-step-id="deposit-canister">Bring the filled canister…</li>
 *   <li><i>Repeat Steps <span data-step-ref="charge-canister"
 *          data-step-ref-to="deposit-canister"></span> for the other two.</i></li>
 *
 * renders as "Repeat Steps 11-13 for the other two." Drop `data-step-ref-to`
 * for a single step. The <span> is replaced by the text outright, so nothing
 * about it survives into the output.
 *
 * Ranges join with "-"; guides that were written with an en dash keep it via
 * `data-step-ref-sep="–"`.
 *
 * Names are page-scoped: a reference resolves only against steps in the same
 * file. An unresolved name warns and renders as the name itself, which is ugly
 * on purpose — it surfaces in the dev preview instead of shipping a silent "?".
 */
function resolveStepRefs(document, outputPath) {
    const refs = document.querySelectorAll("[data-step-ref]");
    if (!refs.length) return false;

    const numbers = collectStepNumbers(document, outputPath);

    for (const ref of refs) {
        const from = ref.getAttribute("data-step-ref");
        const to = ref.getAttribute("data-step-ref-to");

        for (const [attr, name] of [["data-step-ref", from], ["data-step-ref-to", to]]) {
            if (name && !numbers.has(name)) {
                console.warn(
                    `[resolveStepRefs] ${attr}="${name}" in ${outputPath} matches no data-step-id.`,
                );
            }
        }

        const start = numbers.get(from);
        const end = to ? numbers.get(to) : start;
        const sep = ref.getAttribute("data-step-ref-sep") || "-";

        let text;
        if (start === undefined || end === undefined) {
            text = to ? `${from}${sep}${to}` : from;
        } else if (end < start) {
            console.warn(
                `[resolveStepRefs] range "${from}"→"${to}" in ${outputPath} runs backwards (${start}${sep}${end}).`,
            );
            text = `${start}${sep}${end}`;
        } else {
            text = start === end ? `${start}` : `${start}${sep}${end}`;
        }

        ref.replaceWith(document.createTextNode(text));
    }

    return true;
}

module.exports = { resolveStepRefs };
