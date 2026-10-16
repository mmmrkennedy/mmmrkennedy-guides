// Cloudflare Pages Function — reading analytics collector.
//
//   POST /api/reading   (beacon body, JSON)  → 204, no body
//
// One row per pageview in the D1 `pageviews` table (migrations/0006_analytics.sql).
// The client (src/ts/ui/reading.ts) sends the FULL cumulative state every time and
// always under the same `pvid`, so this is an upsert, not an append: a reader who
// alt-tabs to the game twenty times updates one row twenty times instead of
// minting twenty rows. See the migration for why that shape was chosen.
//
// WHAT IS DELIBERATELY NOT STORED
//
// No IP, no IP hash, no user agent, no referrer URL, no cookie. _shared.js has
// hashIp() and this file pointedly does not call it: flags need a stable hash to
// dedupe reports, analytics needs nothing of the kind. What is kept is coarse and
// unlinkable — a referrer BUCKET ('google', not the search URL), a device class
// off the viewport width, and CF-IPCountry. The `sess` id lives in sessionStorage
// and dies with the tab, so it links pages within one visit and nothing beyond.
//
// The cost of having no IP hash is that there is no per-IP rate limit here. The
// mitigations are the body cap, the hostname gate and ANALYTICS_OFF; the worst a
// determined person can do is add junk rows to a private curiosity dashboard,
// which is a better trade than putting an IP-derived column in this table.
//
// Response is always 204 with no body — sendBeacon discards it either way. The
// X-Reading-Status header says what actually happened, which is what makes the
// endpoint testable with curl.

import { normalizePath, isProductionHost, isPreviewHost } from "./_shared.js";

const SCHEMA_VERSION = 1;

// Caps. A beacon carrying more than this is clamped, never rejected outright:
// a truncated read is worth more than no read.
const MAX_BODY = 8192;
const MAX_SECTIONS = 60;
const MAX_EVENTS = 40;
const MAX_SOLVERS = 8;
const MAX_SECONDS = 7200; // 2h; longer than any real sitting, short enough to bound junk
const MAX_HIDES = 500;
const MAX_STATES = 999;
const MAX_EVENT_VALUE = 120;

// Vocabularies. Anything outside them is dropped rather than stored, so the
// dashboard never has to defend itself against a value the client invented.
const REFS = new Set([
    "google",
    "bing",
    "duckduckgo",
    "yahoo",
    "reddit",
    "youtube",
    "discord",
    "twitter",
    "facebook",
    "internal",
    "direct",
    "other",
]);
const DEVICES = new Set(["mobile", "tablet", "desktop"]);
const EVENT_TYPES = new Set(["toc", "img", "nav", "out", "tab", "top"]);

const PVID_RE = /^[a-f0-9]{16}$/;
const SESS_RE = /^[a-f0-9]{8}$/;
const SECTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SOLVER_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const CC_RE = /^[A-Za-z]{2}$/;

// Rows are kept for a year, pruned opportunistically rather than on a schedule:
// Pages Functions have no cron, and a 1-in-N delete under waitUntil costs the
// request nothing. Same "best effort, never block the response" contract as the
// view_days write in views.js.
const RETENTION_DAYS = 365;
const PRUNE_ODDS = 200;

function noContent(status) {
    return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store", "X-Reading-Status": status },
    });
}

/** Whole number inside [min, max], or `fallback` for anything else. */
function int(value, min, max, fallback = 0) {
    const n = typeof value === "number" ? Math.round(value) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

/** A member of `allowed`, or null. */
function enumerated(value, allowed) {
    return typeof value === "string" && allowed.has(value) ? value : null;
}

/** A section id, or null. Ids come from the page's own HTML, so this is a shape check. */
function sectionId(value) {
    return typeof value === "string" && SECTION_ID_RE.test(value) ? value : null;
}

/**
 * { "<section-id>": <dwell seconds> }, cleaned.
 *
 * Key presence means "the reader reached this section" and the value means "and
 * stayed N seconds", so a zero is meaningful and is kept.
 */
function sections(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    let n = 0;
    for (const [key, value] of Object.entries(raw)) {
        if (n >= MAX_SECTIONS) break;
        const id = sectionId(key);
        if (!id) continue;
        out[id] = int(value, 0, MAX_SECONDS);
        n++;
    }
    return n === 0 ? null : JSON.stringify(out);
}

/** [ ["toc","main_ee"], ... ], cleaned. Unknown event types are dropped. */
function events(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const entry of raw) {
        if (out.length >= MAX_EVENTS) break;
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const type = enumerated(entry[0], EVENT_TYPES);
        if (!type) continue;
        const value = typeof entry[1] === "string" ? entry[1].slice(0, MAX_EVENT_VALUE) : "";
        out.push([type, value]);
    }
    return out.length === 0 ? null : JSON.stringify(out);
}

/**
 * { "<SolverName>": { m, e, n, f, t } }, cleaned.
 *   m = mounted, e = reader gave it input, n = distinct input states tried,
 *   f = every published input was filled at the end, t = seconds on screen.
 */
function solvers(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    let n = 0;
    for (const [name, stat] of Object.entries(raw)) {
        if (n >= MAX_SOLVERS) break;
        if (!SOLVER_NAME_RE.test(name)) continue;
        if (!stat || typeof stat !== "object" || Array.isArray(stat)) continue;
        out[name] = {
            m: int(stat.m, 0, 1),
            e: int(stat.e, 0, 1),
            n: int(stat.n, 0, MAX_STATES),
            f: int(stat.f, 0, 1),
            t: int(stat.t, 0, MAX_SECONDS),
        };
        n++;
    }
    return n === 0 ? null : JSON.stringify(out);
}

export async function onRequestPost({ request, env, waitUntil }) {
    // Kill switch, so collection can be stopped from the dashboard without a
    // redeploy. Checked before anything else touches the body or the DB.
    if (env && env.ANALYTICS_OFF) return noContent("disabled");
    if (!env || !env.DB) return noContent("no-db");

    const url = new URL(request.url);
    const production = isProductionHost(url);
    // Preview traffic is stored, tagged, and hidden from the dashboard by
    // default — that is what makes the whole path testable before it ships.
    // Any other hostname is somebody else's problem and writes nothing.
    if (!production && !isPreviewHost(url)) return noContent("host");

    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY) return noContent("too-large");

    let body;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY) return noContent("too-large");
        body = JSON.parse(text);
    } catch {
        return noContent("bad-json");
    }
    if (!body || typeof body !== "object" || body.v !== SCHEMA_VERSION) return noContent("bad-body");

    // pvid is the row key, so a bad one is the one thing worth refusing over:
    // without it the upsert cannot be idempotent and a long read fans out into
    // one row per alt-tab.
    const pvid = typeof body.id === "string" && PVID_RE.test(body.id) ? body.id : null;
    if (!pvid) return noContent("bad-pvid");

    const path = normalizePath(body.p);
    if (!path) return noContent("bad-path");

    const cc = typeof request.headers.get === "function" ? request.headers.get("CF-IPCountry") : null;

    const now = Math.floor(Date.now() / 1000);
    const row = {
        pvid,
        day: new Date().toISOString().slice(0, 10),
        ts: now,
        updated: now,
        path,
        prev: production ? 0 : 1,
        sess: typeof body.s === "string" && SESS_RE.test(body.s) ? body.s : null,
        ref: enumerated(body.r, REFS),
        dev: enumerated(body.d, DEVICES),
        cc: cc && CC_RE.test(cc) ? cc.toUpperCase() : null,
        engaged: int(body.t, 0, MAX_SECONDS),
        depth: int(body.z, 0, 100),
        hides: int(body.h, 0, MAX_HIDES),
        sec_first: sectionId(body.f),
        sec_last: sectionId(body.l),
        sections: sections(body.sec),
        events: events(body.ev),
        solvers: solvers(body.sv),
    };

    // Everything that can only be known once stays from the first beacon:
    // `ts` is when the read started, `sec_first` is where the reader came in,
    // and the request context (path, host, country, device) cannot change
    // mid-pageview. Everything that accumulates is overwritten with the newer,
    // larger, cumulative value.
    try {
        await env.DB.prepare(
            "INSERT INTO pageviews " +
                "(pvid, day, ts, updated, path, prev, sess, ref, dev, cc, engaged, depth, hides, " +
                " sec_first, sec_last, sections, events, solvers) " +
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18) " +
                "ON CONFLICT(pvid) DO UPDATE SET " +
                "updated = excluded.updated, engaged = excluded.engaged, depth = excluded.depth, " +
                "hides = excluded.hides, sec_last = excluded.sec_last, sections = excluded.sections, " +
                "events = excluded.events, solvers = excluded.solvers",
        )
            .bind(
                row.pvid,
                row.day,
                row.ts,
                row.updated,
                row.path,
                row.prev,
                row.sess,
                row.ref,
                row.dev,
                row.cc,
                row.engaged,
                row.depth,
                row.hides,
                row.sec_first,
                row.sec_last,
                row.sections,
                row.events,
                row.solvers,
            )
            .run();
    } catch (err) {
        // Table not migrated yet, or a write error. A missing beacon is not worth
        // an error the reader can see, and there is nothing for them to retry.
        console.error("reading: insert failed —", (err && err.message) || err);
        return noContent("write-failed");
    }

    if (waitUntil && Math.random() * PRUNE_ODDS < 1) waitUntil(prune(env));

    return noContent("ok");
}

async function prune(env) {
    try {
        await env.DB.prepare("DELETE FROM pageviews WHERE day < date('now', ?1)")
            .bind(`-${RETENTION_DAYS} day`)
            .run();
    } catch {
        /* best effort; the next request rolls the dice again */
    }
}
