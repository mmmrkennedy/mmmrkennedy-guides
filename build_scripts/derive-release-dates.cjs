#!/usr/bin/env node
/**
 * derive-release-dates.cjs
 *
 * Reconstructs the "initial release" date of every guide by replaying the
 * history of index.html across BOTH repos (the old zombiesGuides one and the
 * current zombiesGuidesPublic one, which took over on 2024-03-27).
 *
 * Release signal: the index link for the guide is *enabled*. Three eras of
 * markup:
 *   2023-07-29 .. 2023-09-06  every link is <a> (the index was a roadmap of
 *                             maps to write, so an <a> means nothing on its own)
 *   2023-09-06 .. 2025-09-28  unreleased guides use <n href=...> instead of <a>
 *   2025-09-28 .. now         unreleased guides are <a ... class="disabled">
 *
 * Guards against the ways that signal lies:
 *   - the page has to exist in the tree at that commit, and during the roadmap
 *     era it also has to be bigger than STUB_BYTES (placeholder files landed
 *     while every link was still <a>)
 *   - if the same href appears twice in one snapshot and either sighting is
 *     disabled, the guide counts as disabled (a solver link next to a disabled
 *     guide link used to share its href)
 *   - a guide that is disabled in the *current* index was never released, no
 *     matter what the history says (covers accidental releases that got pulled)
 *
 * Cross-checks each date against the nearest "Finished <map>" commit subject so
 * accidental early releases show up as a mismatch rather than silently winning.
 *
 * Output: release-dates.json + a table on stdout.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
    tokens,
    toKey,
    scrapeSightings,
    foldSightings,
    nameHintsFrom,
    hasUnreleasedConvention,
} = require("./index-links.cjs");

const REPOS = [
    { name: "zombiesGuides", dir: "D:/programming_projects/zombiesGuides" },
    { name: "zombiesGuidesPublic", dir: "D:/programming_projects/mmmrkennedy-guides" },
];

const CURRENT_REPO = REPOS[1];
const INDEX_PATHS = ["index.html", "src/index.html"];

// Roadmap-era only: a guide file smaller than this is a placeholder.
const STUB_BYTES = 4000;

// How far a "Finished ..." commit can sit from the index-enable date before the
// row gets flagged for a human to look at.
const MISMATCH_DAYS = 14;

function git(dir, args) {
    return execSync(`git ${args}`, {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 200 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

// Standalone "temp solver" pages that later folded into a map's solver page.
// Kept separate from KEY_ALIASES because whether the temp page counts as the
// solver's initial release is a judgement call, not a rename.
const TEMP_SOLVER_PREDECESSORS = {
    "bo3/gorod_krovi_ee_solver_temp": "bo3/gorod_krovi_solver",
    "bo6/reckoning_solver_temp": "bo6/reckoning_solvers",
    "bo6/terminus_solver_temp": "bo6/beamsmasher_solver",
    "iw/attack_solver_temp": "iw/attack_solvers",
    "iw/shaolin_solver_temp": "iw/shaolin_shuffle_solvers",
    "ww2/dawn_solver_temp": "ww2/the_frozen_dawn_solver",
    "ww2/throne_solver_temp": "ww2/the_shadowed_throne_solvers",
};

// Hand-set dates that beat whatever the index history says, because the index
// history is wrong about them. Each one needs a reason.
const RELEASE_OVERRIDES = {
    // Went live on 2025-09-28 by accident: the <n> -> class="disabled" rewrite
    // that day missed this row, so an unfinished guide became reachable. The
    // intended release is the day it was actually done.
    "bo3/shadows_of_evil_guide": {
        date: "2025-10-09",
        why: "2025-09-28 index enable was a slip during the disabled-class rewrite",
    },
};

// ------------------------------------------------------------------ tree data

/** Map<key, bytes> for every .html file in the tree at `sha`. */
function treeGuides(dir, sha) {
    const out = new Map();
    let listing;
    try {
        listing = git(dir, `-c core.quotepath=false ls-tree -r -l ${sha}`);
    } catch {
        return out;
    }
    for (const line of listing.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const tabIdx = trimmed.indexOf("\t");
        if (tabIdx === -1) continue;
        const meta = trimmed.slice(0, tabIdx).split(/\s+/);
        const file = trimmed.slice(tabIdx + 1);
        if (!/\.html$/i.test(file)) continue;
        const size = parseInt(meta[3], 10);
        const key = toKey(file);
        if (!key) continue;
        const prev = out.get(key);
        if (prev === undefined || size > prev) out.set(key, isNaN(size) ? 0 : size);
    }
    return out;
}

// ------------------------------------------------------------------- the walk

// Today's index has the hrefs right, so it's the reference for which link text
// belongs to which guide. Built first, because the walk needs it to disambiguate.
const currentIndexHtml = fs.readFileSync(path.join(CURRENT_REPO.dir, "src/index.html"), "utf8");
const nameHints = nameHintsFrom(currentIndexHtml);

const released = new Map(); // key -> first enable that stuck
const enableEvents = new Map(); // key -> [{date, sha, subject, repo}] every enable
const disableEvents = new Map(); // key -> [{date, ...}] every re-disable
const firstSeenFile = new Map();
const names = new Map();
const lastState = new Map(); // key -> boolean, enabled at previous snapshot

for (const repo of REPOS) {
    const pathspec = INDEX_PATHS.map((p) => `"${p}"`).join(" ");
    const log = git(
        repo.dir,
        `log --reverse --date-order --format=%H%x1f%cI%x1f%s -- ${pathspec}`
    ).trim();
    if (!log) continue;

    const commits = log.split("\n").map((line) => {
        const [sha, date, subject] = line.split("\x1f");
        return { sha, date, subject };
    });
    process.stderr.write(`${repo.name}: ${commits.length} index commits\n`);

    for (const commit of commits) {
        let html = null;
        for (const p of INDEX_PATHS) {
            try {
                html = git(repo.dir, `show ${commit.sha}:${p}`);
                break;
            } catch {
                /* try the next path */
            }
        }
        if (html === null) continue;

        const roadmapEra = !hasUnreleasedConvention(html);
        const links = foldSightings(scrapeSightings(html), nameHints);
        const tree = treeGuides(repo.dir, commit.sha);

        for (const [key, size] of tree) {
            if (!firstSeenFile.has(key)) {
                firstSeenFile.set(key, {
                    repo: repo.name,
                    date: commit.date,
                    subject: commit.subject,
                    bytes: size,
                });
            }
        }

        for (const [key, link] of links) {
            if (link.text && !names.has(key)) names.set(key, link.text);

            const bytes = tree.get(key);
            const live =
                link.enabled &&
                bytes !== undefined &&
                (!roadmapEra || bytes >= STUB_BYTES);

            const was = lastState.get(key);
            const event = {
                repo: repo.name,
                sha: commit.sha.slice(0, 8),
                date: commit.date,
                subject: commit.subject,
            };
            if (live && was !== true) {
                if (!enableEvents.has(key)) enableEvents.set(key, []);
                enableEvents.get(key).push(event);
                if (!released.has(key)) released.set(key, event);
            } else if (!live && was === true) {
                if (!disableEvents.has(key)) disableEvents.set(key, []);
                disableEvents.get(key).push(event);
            }
            lastState.set(key, live);
        }
    }
}

// ------------------------------------------------------- "Finished X" commits

// Hand-written for subjects that abbreviate the map name past recognition.
const SUBJECT_HINTS = [
    [/\bzis\b/i, "iw/zombies_in_spaceland_guide"],
    [/finished attack\b/i, "iw/attack_of_the_radioactive_thing_guide"],
    [/finished nacht\b/i, "waw/nacht_der_untoten_guide"],
    [/groesten/i, "ww2/groesten_haus_guide"],
    [/der riese/i, "waw/der_riese_guide"],
    [/dotn/i, "bo4/dead_of_the_night_guide"],
    [/finished voyage\b/i, "bo4/voyage_of_despair_guide"],
    [/finished classified\b/i, "bo4/classified_guide"],
    [/finished ix\b/i, "bo4/ix_guide"],
];

const FINISH_RE = /\b(finish(?:ed)?|complet(?:ed|ely finished))\b/i;

const finishCommits = [];
for (const repo of REPOS) {
    const log = git(repo.dir, `log --reverse --date-order --format=%H%x1f%cI%x1f%s`).trim();
    for (const line of log.split("\n")) {
        const [sha, date, subject] = line.split("\x1f");
        if (!subject || !FINISH_RE.test(subject)) continue;
        finishCommits.push({ repo: repo.name, sha: sha.slice(0, 8), date, subject });
    }
}

/** Best "Finished ..." commit for a guide key, or null. */
function bestFinishCommit(key) {
    const guideTokens = tokens(key.split("/")[1]);
    let best = null;
    for (const c of finishCommits) {
        let score = 0;
        for (const [re, hintKey] of SUBJECT_HINTS) {
            if (hintKey === key && re.test(c.subject)) score = 1;
        }
        if (score === 0 && guideTokens.length) {
            const subjectTokens = new Set(tokens(c.subject));
            const hits = guideTokens.filter((t) => subjectTokens.has(t)).length;
            score = hits / guideTokens.length;
        }
        if (score >= 0.6 && (!best || score > best.score || (score === best.score && c.date < best.date))) {
            best = { ...c, score };
        }
    }
    return best;
}

// ------------------------------------------------------------------- reporting

const currentLinks = foldSightings(scrapeSightings(currentIndexHtml), nameHints);

const currentFiles = git(CURRENT_REPO.dir, `-c core.quotepath=false ls-files -- "src/games/**/*.html"`)
    .trim()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);

const currentByKey = new Map();
for (const f of currentFiles) {
    const key = toKey(f);
    if (key) currentByKey.set(key, f);
}

const day = (iso) => (iso ? iso.slice(0, 10) : null);
const daysBetween = (a, b) =>
    Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);

const rows = [];
for (const [key, file] of [...currentByKey].sort()) {
    const link = currentLinks.get(key);
    const liveNow = link ? link.enabled : null;
    const rel = released.get(key);
    const finish = bestFinishCommit(key);
    const first = firstSeenFile.get(key);

    // A guide that is disabled today was never really released.
    const derivedDate = liveNow === false ? null : rel ? day(rel.date) : null;
    const override = RELEASE_OVERRIDES[key];
    const releaseDate = override ? override.date : derivedDate;

    // Enables on a page that is disabled today: the guide went live by mistake
    // and got pulled. Worth surfacing, but not a release.
    const accidental = liveNow === false ? (enableEvents.get(key) || []) : [];

    let flag = "";
    if (override) flag = "override";
    else if (liveNow === false) flag = accidental.length ? "pulled" : "unreleased";
    else if (!releaseDate) flag = "NO DATE";
    else if (finish && daysBetween(finish.date, rel.date) > MISMATCH_DAYS) flag = "mismatch";
    else if (new Set((enableEvents.get(key) || []).map((e) => day(e.date))).size > 1)
        flag = "re-enabled"; // same-day flips are just two commits in one session

    // Predecessor page, if this key had one.
    const predecessorKey = Object.keys(TEMP_SOLVER_PREDECESSORS).find(
        (k) => TEMP_SOLVER_PREDECESSORS[k] === key
    );
    const predecessor = predecessorKey && released.get(predecessorKey)
        ? { key: predecessorKey, date: day(released.get(predecessorKey).date) }
        : null;

    rows.push({
        key,
        file,
        name: names.get(key) || "",
        live_now: liveNow,
        release_date: releaseDate,
        derived_date: derivedDate,
        override_reason: override ? override.why : null,
        release_repo: rel ? rel.repo : null,
        release_commit: rel ? rel.sha : null,
        release_subject: rel ? rel.subject : null,
        finished_date: finish ? day(finish.date) : null,
        finished_subject: finish ? finish.subject : null,
        file_first_seen: first ? day(first.date) : null,
        enable_count: (enableEvents.get(key) || []).length,
        accidental_releases: accidental.map((e) => ({ date: day(e.date), subject: e.subject })),
        predecessor,
        flag,
    });
}

// Full audit trail: every signal per guide, for re-checking the judgement
// calls later. Opt-in so it doesn't sit in the repo: --audit <path>.
const auditFlag = process.argv.indexOf("--audit");
if (auditFlag !== -1 && process.argv[auditFlag + 1]) {
    fs.writeFileSync(
        process.argv[auditFlag + 1],
        JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2) + "\n"
    );
}

// The artifact the build consumes: repo-root-relative path -> release date,
// same key shape as lastmod-cache.json. Unreleased pages are simply absent.
// This can't be regenerated on CI, because half of it comes from the old repo's
// history, which only exists on Mark's machine, so it is committed as data.
const cache = {};
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
    if (r.release_date) cache[r.file] = r.release_date;
}
fs.writeFileSync(
    path.join(CURRENT_REPO.dir, "build_scripts/release-dates.json"),
    JSON.stringify(cache, null, 2) + "\n"
);

const pad = (s, n) => String(s === null || s === undefined ? "" : s).padEnd(n);
console.log(
    pad("KEY", 44) + pad("RELEASED", 12) + pad("FINISHED", 12) + pad("PRED.", 12) + pad("FLAG", 12) + "RELEASE COMMIT"
);
console.log("-".repeat(140));
for (const r of rows) {
    console.log(
        pad(r.key, 44) +
            pad(r.release_date || "-", 12) +
            pad(r.finished_date || "-", 12) +
            pad(r.predecessor ? r.predecessor.date : "-", 12) +
            pad(r.flag, 12) +
            (r.release_subject || "").slice(0, 60)
    );
}

const dated = rows.filter((r) => r.release_date).length;
const unreleased = rows.filter((r) => r.live_now === false).length;
const missing = rows.filter((r) => !r.release_date && r.live_now !== false);
console.log(
    `\n${rows.length} pages: ${dated} dated, ${unreleased} still unreleased, ${missing.length} live but undated.`
);
if (missing.length) console.log(`Live but undated: ${missing.map((r) => r.key).join(", ")}`);

const pulled = rows.filter((r) => r.flag === "pulled");
if (pulled.length) {
    console.log(`\nWent live then got pulled (disabled today, so not counted as released):`);
    for (const r of pulled) {
        console.log(`  ${pad(r.key, 44)} ${r.accidental_releases.map((a) => a.date).join(", ")}`);
    }
}

const reEnabled = rows.filter((r) => r.flag === "re-enabled");
if (reEnabled.length) {
    console.log(`\nEnabled more than once (first enable used; check it wasn't a slip):`);
    for (const r of reEnabled) {
        const evs = enableEvents.get(r.key) || [];
        console.log(`  ${pad(r.key, 44)} ${evs.map((e) => day(e.date)).join(", ")}`);
    }
}

const mismatches = rows.filter((r) => r.flag === "mismatch");
if (mismatches.length) {
    console.log(`\nMismatches (index enable vs "Finished" commit, >${MISMATCH_DAYS}d apart):`);
    for (const r of mismatches) {
        console.log(`  ${pad(r.key, 44)} index ${r.release_date}  |  "${r.finished_subject}" ${r.finished_date}`);
    }
}
