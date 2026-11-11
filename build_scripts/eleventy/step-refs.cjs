/**
 * The number each named step renders as, counted as the browser does: direct <li>
 * children only, honouring `start` and `value`, and skipping `.dummy-li`, whose
 * counter-increment typography.css zeroes.
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
 * Replaces named step references with the step's number, so "Repeat Steps 11-13"
 * can't go stale when a step is inserted above it:
 *
 *   <li data-step-id="charge-canister">Insert the canister into the harvester…</li>
 *   <li data-step-id="deposit-canister">Bring the filled canister…</li>
 *   <li><i>Repeat Steps <span data-step-ref="charge-canister"
 *          data-step-ref-to="deposit-canister"></span> for the other two.</i></li>
 *
 * renders as "Repeat Steps 11-13 for the other two." Drop `data-step-ref-to` for a
 * single step. Ranges join with "-", or set `data-step-ref-sep`. Names are per page.
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
