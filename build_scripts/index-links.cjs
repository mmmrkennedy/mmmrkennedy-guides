/**
 * index-links.cjs
 *
 * Reading the guide links out of index.html, and deciding which of them are
 * *enabled*: which guides the site is actually publishing right now.
 *
 * Shared by derive-release-dates.cjs (which replays this over all of history)
 * and stamp-release-dates.cjs (which runs it on two snapshots in a git hook).
 * They have to agree on what "released" means, so the logic lives here once.
 *
 * Three eras of markup mark a guide as unreleased:
 *   2023-07-29 .. 2023-09-06  nothing; the index was a roadmap, all links <a>
 *   2023-09-06 .. 2025-09-28  <n href=...> in place of <a>
 *   2025-09-28 .. now         <a ... class="disabled">
 */

// Words that carry no identity: they show up in half the map names, so matching
// on them would pair unrelated guides.
const STOPWORDS = new Set([
    "the", "of", "a", "an", "and", "der", "des", "die", "das", "no", "in",
    "guide", "solver", "solvers", "html", "aw", "cw", "vg", "bo", "ww",
]);

const COMBINING_MARKS = /[̀-ͯ]/g;

// Link text carries the accents the filename slug drops ("Verrückt" vs
// "verruckt", "Kowakujō" vs "kowakujo"), so fold them away before comparing.
function tokens(s) {
    return String(s)
        .normalize("NFD")
        .replace(COMBINING_MARKS, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t && !STOPWORDS.has(t));
}

const GAME_ALIASES = { cw: "bo_cw" };

// Pages that changed name or URL shape over the years, mapped onto the key the
// live file produces today.
const KEY_ALIASES = {
    "vg/shi_no_numa_vg_guide": "vg/shi_no_numa_reborn_guide",
    "bo3/solver": "bo3/gorod_krovi_solver",
    // permalink-style hrefs that dropped the _guide suffix
    "ww2/altar_of_blood": "ww2/altar_of_blood_guide",
    "ww2/bodega_cervantes": "ww2/bodega_cervantes_guide",
    "ww2/uss_mount_olympus": "ww2/uss_mount_olympus_guide",
    "bo6/shattered_veil_solver": "bo6/shattered_veil_mark_2_solver",
};

/**
 * Collapse any historical href or repo path for a guide into one stable key,
 * "game/slug", so the same page lines up across renames and the repo move.
 * Null for anything that isn't a guide page.
 */
function toKey(raw) {
    if (!raw) return null;
    let p = String(raw).trim().replace(/\\/g, "/");
    if (/^(https?:)?\/\//i.test(p)) return null;
    if (p.startsWith("#") || p.startsWith("mailto:")) return null;
    p = p.replace(/[?#].*$/, "");
    p = p.replace(/^\.{1,2}\//, "").replace(/^\//, "");
    p = p.replace(/^src\//i, "");
    if (!/^games\//i.test(p)) return null;
    p = p.replace(/^games\//i, "").replace(/\.html$/i, "");

    const parts = p.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    let game = parts[0].toLowerCase();
    game = GAME_ALIASES[game] || game;

    let slug = parts[parts.length - 1].toLowerCase();
    // Generically-named solvers get their folder name so they stay unique.
    if (/^solvers?$/.test(slug) && parts.length >= 3) {
        slug = `${parts[parts.length - 2].toLowerCase()}_${slug}`;
    }

    const key = `${game}/${slug}`;
    return KEY_ALIASES[key] || key;
}

function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, " ");
}

/** Every guide link in one snapshot, as an array of raw sightings. */
function scrapeSightings(html) {
    const out = [];
    const clean = stripComments(html);
    const re = /<(a|n)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(clean)) !== null) {
        const tag = m[1].toLowerCase();
        const attrs = m[2];
        const text = m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

        const hrefMatch = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
        if (!hrefMatch) continue;
        const key = toKey(hrefMatch[1]);
        if (!key) continue;

        const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
        const classes = classMatch ? classMatch[1].toLowerCase().split(/\s+/) : [];
        out.push({ key, text, enabled: tag === "a" && !classes.includes("disabled") });
    }
    return out;
}

/** Does this link text plausibly name the guide behind `key`? */
function textFitsKey(text, key, nameHints) {
    const t = new Set(tokens(text));
    if (!t.size) return false;
    const candidates = [key.split("/")[1], nameHints.get(key) || ""];
    for (const c of candidates) {
        for (const tok of tokens(c)) if (t.has(tok)) return true;
    }
    return false;
}

/**
 * Collapse sightings into Map<key, {enabled, text}>.
 *
 * The index is full of copy-pasted hrefs. For a stretch of 2025 both "The Tomb"
 * and "Shattered Veil" pointed at liberty_falls_guide.html, and the Void Sword
 * table pointed at the Citadelle guide. So when one href shows up more than
 * once, only the sightings whose link text actually belongs to that guide count;
 * the rest are somebody else's row wearing the wrong href.
 */
function foldSightings(sightings, nameHints) {
    const byKey = new Map();
    for (const s of sightings) {
        if (!byKey.has(s.key)) byKey.set(s.key, []);
        byKey.get(s.key).push(s);
    }

    const out = new Map();
    for (const [key, group] of byKey) {
        let considered = group;
        if (group.length > 1) {
            const compatible = group.filter((s) => textFitsKey(s.text, key, nameHints));
            if (compatible.length === 0) continue; // every sighting belongs to another row
            considered = compatible;
        }
        out.set(key, {
            enabled: considered.some((s) => s.enabled),
            text: considered.find((s) => s.text)?.text || "",
        });
    }
    return out;
}

/**
 * Which link text belongs to which guide, learned from a snapshot whose hrefs we
 * trust. Only rows with an unambiguous href teach anything, since a duplicated
 * href is exactly the case this is meant to resolve.
 */
function nameHintsFrom(html) {
    const sightings = scrapeSightings(html);
    const counts = new Map();
    for (const s of sightings) counts.set(s.key, (counts.get(s.key) || 0) + 1);

    const hints = new Map();
    for (const s of sightings) {
        if (counts.get(s.key) === 1 && s.text) hints.set(s.key, s.text);
    }
    return hints;
}

/** Convenience: the set of guide keys a snapshot publishes. */
function enabledKeys(html, nameHints) {
    const links = foldSightings(scrapeSightings(html), nameHints);
    const out = new Set();
    for (const [key, link] of links) if (link.enabled) out.add(key);
    return out;
}

/** True once the index has a way to mark a link unreleased. */
function hasUnreleasedConvention(html) {
    return /<n\s+href/i.test(html) || /class\s*=\s*["'][^"']*\bdisabled\b/i.test(html);
}

module.exports = {
    STOPWORDS,
    tokens,
    toKey,
    scrapeSightings,
    foldSightings,
    nameHintsFrom,
    enabledKeys,
    hasUnreleasedConvention,
};
