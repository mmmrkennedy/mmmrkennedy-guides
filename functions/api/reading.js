// Reading analytics collector for src/ts/ui/reading.ts, one row per pageview in D1
// `pageviews` (migrations/0006_analytics.sql). The client resends cumulative state
// under the same `pvid`, so this upserts.
//
// Deliberately stores no IP or IP hash (don't call hashIp() here), so there is no
// per-IP rate limit; the body cap, host gate and ANALYTICS_OFF are the mitigations.
//
// Always 204 (sendBeacon ignores the body); X-Reading-Status says what happened.

import { normalizePath, isProductionHost, isPreviewHost } from "./_shared.js";

const SCHEMA_VERSION = 1;

// Oversized fields are clamped, not rejected: a truncated read beats no read.
const MAX_BODY = 8192;
const MAX_SECTIONS = 60;
const MAX_EVENTS = 40;
const MAX_SOLVERS = 8;
const MAX_SECONDS = 7200;
const MAX_HIDES = 500;
const MAX_STATES = 999;
const MAX_EVENT_VALUE = 120;

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

// Pruned 1-in-N under waitUntil because Pages Functions have no cron.
const RETENTION_DAYS = 365;
const PRUNE_ODDS = 200;

function noContent(status) {
    return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "no-store", "X-Reading-Status": status },
    });
}

function int(value, min, max, fallback = 0) {
    const n = typeof value === "number" ? Math.round(value) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function enumerated(value, allowed) {
    return typeof value === "string" && allowed.has(value) ? value : null;
}

function sectionId(value) {
    return typeof value === "string" && SECTION_ID_RE.test(value) ? value : null;
}

/** { "<section-id>": <dwell seconds> }. A zero still means "reached", so it is kept. */
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

/** [ ["toc","main_ee"], ... ] */
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
 * { "<SolverName>": { m, e, n, f, t } }
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
    // Kill switch, settable in the Cloudflare dashboard without a redeploy.
    if (env && env.ANALYTICS_OFF) return noContent("disabled");
    if (!env || !env.DB) return noContent("no-db");

    const url = new URL(request.url);
    const production = isProductionHost(url);
    // Preview traffic is stored with prev=1 and hidden from the dashboard by default.
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

    // pvid is the upsert key; without it a long read fans out into a row per alt-tab.
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

    // First-beacon fields (ts, sec_first, request context) are never overwritten.
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
        /* best effort */
    }
}
