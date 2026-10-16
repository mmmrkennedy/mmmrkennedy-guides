// Admin page for the reading analytics collected by functions/api/reading.js.
//
//   GET /admin/analytics[?days=7|28|90|365][&traffic=live|preview]  → site overview
//   GET /admin/analytics?path=/games/...[&days=...]                 → one page, by section
//
// The overview answers "what is being read". The drill-down answers the question
// the whole feature exists for: which SECTIONS of a guide get read, where readers
// come in, and where they stop.
//
// Everything is aggregated at read time with json_each over the `sections`,
// `events` and `solvers` columns — there are no rollup tables. At ~1k rows/day a
// 90-day window is ~90k rows against D1's 5M/day read budget, and skipping the
// rollup means a new question is a new SELECT rather than a migration.
//
// Section ids are not self-describing ("main_ee_step_4"), so titles are read back
// out of the built page itself through env.ASSETS. No manifest, no build step,
// and a section renamed since it was recorded simply falls back to its id.
//
// Same auth as /admin/flags: signed session cookie, ADMIN_USER + ADMIN_PASS.
// Requires the D1 binding `DB` and migrations/0006_analytics.sql.

import { esc, htmlResponse, requireSession } from "./_auth.js";
import { normalizePath } from "../api/_shared.js";

const WINDOWS = [7, 28, 90, 365];
const DEFAULT_DAYS = 28;
const TOP_PAGES = 25;

/** Rows the section-title scraper will look at. Guides run to ~30 sections. */
const MAX_TITLE_SCAN = 400000;

function since(days) {
    return new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
}

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function thousands(n) {
    return num(n).toLocaleString("en-US");
}

/** 94 -> "1m 34s". Durations here are dwell times, so seconds matter. */
function duration(seconds) {
    const s = Math.round(num(seconds));
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest === 0 ? m + "m" : `${m}m ${rest}s`;
}

function pct(part, whole) {
    const w = num(whole);
    if (w <= 0) return 0;
    return Math.round((num(part) / w) * 100);
}

/** A proportional bar, sized against the largest value in its own table. */
function bar(value, max) {
    const width = max > 0 ? Math.max(1.5, (num(value) / num(max)) * 100) : 0;
    return `<span class="plot"><span class="bar" style="width:${width.toFixed(2)}%"></span></span>`;
}

async function query(env, sql, binds = []) {
    try {
        const { results } = await env.DB.prepare(sql).bind(...binds).all();
        return results || [];
    } catch (err) {
        // A missing table (migration not applied yet) must not take the whole
        // page down — every section renders independently.
        console.error("analytics query failed —", (err && err.message) || err);
        return [];
    }
}

/**
 * Section id -> heading text, read out of the built page.
 *
 * Three shapes, because the site writes headings three ways. A section is
 * `<div class="content-container" id="pap"><h2>Pack-a-Punch</h2>`. A sub-section
 * — a single bow, a single quest step, which is the granularity worth having —
 * carries its id on the heading itself and that heading is a styled `<p>`:
 * `<p class="title-tier-2" id="storm_bow">Storm Bow …</p>`. The home page uses
 * `<h2 id="BO3">Black Ops 3</h2>`.
 *
 * Heading-borne ids are matched first so they win over a container that merely
 * has one nearby.
 */
async function sectionTitles(env, request, path) {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return new Map();
    let html;
    try {
        const res = await env.ASSETS.fetch(new URL(path, request.url).toString());
        if (!res.ok) return new Map();
        html = (await res.text()).slice(0, MAX_TITLE_SCAN);
    } catch {
        return new Map();
    }

    const titles = new Map();
    const headingRe =
        /<(p|h[1-6])[^>]*\bid="([A-Za-z0-9_-]{1,64})"[^>]*>([\s\S]{0,300}?)<\/\1>/g;
    const containerRe =
        /id="([A-Za-z0-9_-]{1,64})"[^>]*>[\s\S]{0,300}?<h2[^>]*>([\s\S]{0,300}?)<\/h2>/g;

    // The tag backreference in headingRe costs it a capture group, so each
    // pattern says where its id and its text landed.
    const passes = [
        { re: headingRe, id: 2, text: 3 },
        { re: containerRe, id: 1, text: 2 },
    ];
    for (const pass of passes) {
        let match;
        while ((match = pass.re.exec(html)) !== null) {
            const id = match[pass.id];
            if (titles.has(id)) continue;
            const text = plainText(match[pass.text]);
            if (text) titles.set(id, text);
        }
    }
    return titles;
}

function plainText(raw) {
    return raw
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
}

const STYLES = `
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#15171b;color:#e8e8ea;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:1rem 1.25rem;border-bottom:1px solid #2a2e35;position:sticky;top:0;background:#15171b;z-index:2}
  h1{margin:0 0 .5rem;font-size:1.15rem}
  h2{margin:0 0 .15rem;font-size:1rem;color:#e8e8ea}
  .titlebar{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap}
  .signout{margin:0}
  .signout button{font-size:.8em}
  nav{display:flex;gap:.5rem;flex-wrap:wrap}
  nav a{color:#cbd2dd;text-decoration:none;padding:.25rem .6rem;border:1px solid #2a2e35;border-radius:999px}
  nav a.active{border-color:#6ea8fe;color:#fff;background:#1d2733}
  nav.sub{margin-top:.4rem}
  nav.sub a{font-size:.85em;padding:.15rem .5rem}
  main{padding:1.25rem;display:grid;gap:1.5rem;max-width:1100px}
  section{border:1px solid #23272e;border-radius:10px;padding:.9rem 1rem;background:#181b20}
  .note{margin:0 0 .7rem;font-size:.85em;opacity:.55}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.6rem;padding:0;margin:0;list-style:none}
  .tile{border:1px solid #23272e;border-radius:8px;padding:.55rem .7rem;background:#1b1f26}
  .tile b{display:block;font-size:1.35rem;font-weight:600;line-height:1.2}
  .tile span{font-size:.78em;color:#8f98a5}
  table{border-collapse:collapse;width:100%}
  th,td{padding:.35rem .5rem;border-bottom:1px solid #23272e;text-align:left;vertical-align:middle}
  th{font-weight:600;color:#aeb6c2;font-size:.82em}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tr:hover{background:#1a1d23}
  a{color:#9fc6ff}
  .plot{display:block;height:8px;border-radius:999px;background:#23272e;min-width:60px}
  .bar{display:block;height:100%;border-radius:999px;background:#6ea8fe}
  .bar.warm{background:#f1b86b}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82em}
  .dim{opacity:.5}
  .empty{opacity:.6;margin:.2rem 0 0}
  .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1.5rem}
  .banner{margin:0 1.25rem;padding:.55rem .7rem;border-radius:8px;border:1px solid #5a4a1f;background:#241f18;color:#f1d9a8;font-size:.88rem}
  .back{font-size:.85em}
`;

function shell({ title, header, body }) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${STYLES}</style></head>
<body>
${header}
<main>
${body}
</main>
</body></html>`;
}

export async function onRequestGet({ request, env }) {
    const denied = await requireSession(request, env);
    if (denied) return denied;
    if (!env.DB) return htmlResponse("<h1>DB binding 'DB' is not configured</h1>", 500);

    const url = new URL(request.url);

    let days = parseInt(url.searchParams.get("days"), 10);
    if (!WINDOWS.includes(days)) days = DEFAULT_DAYS;

    // Preview deploys write too, tagged, so the pipeline can be tested before it
    // ships. Live traffic is what the dashboard means unless asked otherwise.
    const traffic = url.searchParams.get("traffic") === "preview" ? "preview" : "live";
    const prev = traffic === "preview" ? 1 : 0;

    const path = url.searchParams.get("path") ? normalizePath(url.searchParams.get("path")) : null;
    const from = since(days);

    const qs = (over = {}) => {
        const p = { days, traffic, path, ...over };
        const parts = [`days=${p.days}`, `traffic=${encodeURIComponent(p.traffic)}`];
        if (p.path) parts.push(`path=${encodeURIComponent(p.path)}`);
        return "/admin/analytics?" + parts.join("&");
    };

    const dayLink = (n) =>
        `<a${n === days ? ' class="active"' : ""} href="${qs({ days: n })}">${n}d</a>`;
    const trafficLink = (key, label) =>
        `<a${key === traffic ? ' class="active"' : ""} href="${qs({ traffic: key })}">${label}</a>`;

    const header = `<header>
  <div class="titlebar">
    <h1>Reading analytics${path ? `: <span class="mono">${esc(path)}</span>` : ""}</h1>
    <form class="signout" method="post" action="/admin/login">
      <input type="hidden" name="action" value="logout">
      <button type="submit">Sign out</button>
    </form>
  </div>
  <nav>
    ${WINDOWS.map(dayLink).join("\n    ")}
    <a href="/admin/flags">Flags &rarr;</a>
  </nav>
  <nav class="sub">
    ${trafficLink("live", "Live traffic")}
    ${trafficLink("preview", "Preview deploys")}
    ${path ? `<a class="back" href="${qs({ path: null })}">&larr; All pages</a>` : ""}
  </nav>
</header>`;

    const body = path
        ? await pageReport(env, request, { path, from, days, prev, qs })
        : await overview(env, { from, days, prev, qs });

    return htmlResponse(shell({ title: "Reading analytics", header, body }));
}

// ---- overview ---------------------------------------------------------------

async function overview(env, { from, days, prev, qs }) {
    const where = "day >= ?1 AND prev = ?2";
    // Spelled out per alias rather than prefixed at the call site: a bare `prev`
    // is ambiguous the moment a query joins pageviews to itself.
    const wherePv = "pv.day >= ?1 AND pv.prev = ?2";
    const binds = [from, prev];

    const [totals] = await query(
        env,
        `SELECT COUNT(*) AS views, COUNT(DISTINCT sess) AS sessions, SUM(engaged) AS secs,
                AVG(engaged) AS avg_engaged, AVG(depth) AS avg_depth, SUM(hides) AS hides
         FROM pageviews WHERE ${where}`,
        binds,
    );

    if (!totals || num(totals.views) === 0) {
        return `<section><h2>No data yet</h2>
<p class="note">Nothing recorded in the last ${days} days. If this is a fresh deploy, check that
migrations/0006_analytics.sql has been applied and that a beacon has had a chance to fire
(the collector sends when a tab is backgrounded or closed).</p></section>`;
    }

    const perDay = await query(
        env,
        `SELECT day, COUNT(*) AS n FROM pageviews WHERE ${where} GROUP BY day ORDER BY day DESC LIMIT 90`,
        binds,
    );
    const pages = await query(
        env,
        `SELECT path, COUNT(*) AS n, AVG(engaged) AS avg_engaged, AVG(depth) AS avg_depth,
                AVG(hides) AS avg_hides
         FROM pageviews WHERE ${where} GROUP BY path ORDER BY n DESC LIMIT ${TOP_PAGES}`,
        binds,
    );
    const refs = await query(
        env,
        `SELECT COALESCE(ref,'unknown') AS k, COUNT(*) AS n FROM pageviews WHERE ${where}
         GROUP BY k ORDER BY n DESC`,
        binds,
    );
    const devices = await query(
        env,
        `SELECT COALESCE(dev,'unknown') AS k, COUNT(*) AS n FROM pageviews WHERE ${where}
         GROUP BY k ORDER BY n DESC`,
        binds,
    );
    const countries = await query(
        env,
        `SELECT cc AS k, COUNT(*) AS n FROM pageviews WHERE ${where} AND cc IS NOT NULL
         GROUP BY k ORDER BY n DESC LIMIT 12`,
        binds,
    );
    const solvers = await query(
        env,
        `SELECT je.key AS solver, COUNT(*) AS mounts,
                SUM(json_extract(je.value,'$.e')) AS engaged,
                SUM(json_extract(je.value,'$.f')) AS filled,
                AVG(json_extract(je.value,'$.n')) AS avg_states,
                AVG(json_extract(je.value,'$.t')) AS avg_secs
         FROM pageviews pv, json_each(pv.solvers) je
         WHERE ${wherePv} AND pv.solvers IS NOT NULL
         GROUP BY je.key ORDER BY mounts DESC LIMIT 25`,
        binds,
    );
    const journeys = await query(
        env,
        `SELECT a.path AS from_path, b.path AS to_path, COUNT(*) AS n
         FROM pageviews a JOIN pageviews b
           ON a.sess = b.sess AND b.ts > a.ts AND b.path <> a.path
         WHERE a.day >= ?1 AND a.prev = ?2 AND a.sess IS NOT NULL
         GROUP BY from_path, to_path ORDER BY n DESC LIMIT 15`,
        binds,
    );

    const tiles = `<ul class="tiles">
  <li class="tile"><b>${thousands(totals.views)}</b><span>pageviews</span></li>
  <li class="tile"><b>${thousands(totals.sessions)}</b><span>tab sessions</span></li>
  <li class="tile"><b>${duration(totals.avg_engaged)}</b><span>avg time reading</span></li>
  <li class="tile"><b>${Math.round(num(totals.avg_depth))}%</b><span>avg scroll depth</span></li>
  <li class="tile"><b>${(num(totals.hides) / num(totals.views)).toFixed(1)}</b><span>avg trips to the game</span></li>
  <li class="tile"><b>${duration(totals.secs)}</b><span>total time on the site</span></li>
</ul>`;

    const dayMax = Math.max(...perDay.map((r) => num(r.n)), 0);
    const dayRows = perDay
        .map(
            (r) => `<tr><td class="mono">${esc(r.day)}</td><td>${bar(r.n, dayMax)}</td>
<td class="n">${thousands(r.n)}</td></tr>`,
        )
        .join("\n");

    const pageMax = Math.max(...pages.map((r) => num(r.n)), 0);
    const pageRows = pages
        .map(
            (r) => `<tr>
  <td><a href="${esc(qs({ path: r.path }))}">${esc(r.path)}</a></td>
  <td>${bar(r.n, pageMax)}</td>
  <td class="n">${thousands(r.n)}</td>
  <td class="n">${duration(r.avg_engaged)}</td>
  <td class="n">${Math.round(num(r.avg_depth))}%</td>
  <td class="n">${num(r.avg_hides).toFixed(1)}</td>
</tr>`,
        )
        .join("\n");

    const breakdown = (rows, label) => {
        if (rows.length === 0) return `<p class="empty">No ${label} recorded.</p>`;
        const max = Math.max(...rows.map((r) => num(r.n)), 0);
        return `<table><tbody>${rows
            .map(
                (r) => `<tr><td>${esc(r.k)}</td><td>${bar(r.n, max)}</td>
<td class="n">${thousands(r.n)}</td><td class="n dim">${pct(r.n, totals.views)}%</td></tr>`,
            )
            .join("\n")}</tbody></table>`;
    };

    const solverRows = solvers
        .map(
            (r) => `<tr>
  <td>${esc(r.solver)}</td>
  <td class="n">${thousands(r.mounts)}</td>
  <td class="n">${pct(r.engaged, r.mounts)}%</td>
  <td class="n">${pct(r.filled, r.mounts)}%</td>
  <td class="n">${num(r.avg_states).toFixed(1)}</td>
  <td class="n">${duration(r.avg_secs)}</td>
</tr>`,
        )
        .join("\n");

    const journeyRows = journeys
        .map(
            (r) => `<tr><td class="mono">${esc(r.from_path)}</td><td class="mono">${esc(r.to_path)}</td>
<td class="n">${thousands(r.n)}</td></tr>`,
        )
        .join("\n");

    return `
<section>
  <h2>Last ${days} days</h2>
  <p class="note">A pageview is one row, written and rewritten under the same id, so a reader who
  alt-tabs twenty times is still one pageview. "Trips to the game" counts those round trips.</p>
  ${tiles}
</section>

<section>
  <h2>Most read pages</h2>
  <p class="note">Click a page for its section-by-section breakdown.</p>
  <table>
    <thead><tr><th>Page</th><th></th><th class="n">Views</th><th class="n">Avg read</th>
    <th class="n">Depth</th><th class="n">Trips</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table>
</section>

<section>
  <h2>Solvers</h2>
  <p class="note">"Used" is a reader who typed something in. "Filled" is a reader whose inputs were
  all complete by the end, which is the closest thing to "got an answer" the solver reports.</p>
  ${
      solvers.length === 0
          ? '<p class="empty">No solver activity recorded.</p>'
          : `<table>
    <thead><tr><th>Solver</th><th class="n">Mounts</th><th class="n">Used</th><th class="n">Filled</th>
    <th class="n">Avg tries</th><th class="n">Avg time</th></tr></thead>
    <tbody>${solverRows}</tbody>
  </table>`
  }
</section>

<div class="grid2">
  <section><h2>Where readers came from</h2>${breakdown(refs, "referrers")}</section>
  <section><h2>Device</h2>${breakdown(devices, "devices")}</section>
  <section><h2>Country</h2>${breakdown(countries, "countries")}</section>
</div>

<section>
  <h2>Pages seen together</h2>
  <p class="note">Page A then page B in the same tab, not necessarily back to back. Guide to solver
  is the pairing worth watching.</p>
  ${
      journeys.length === 0
          ? '<p class="empty">No multi-page sessions recorded.</p>'
          : `<table><thead><tr><th>First</th><th>Later</th><th class="n">Tabs</th></tr></thead>
  <tbody>${journeyRows}</tbody></table>`
  }
</section>

<section>
  <h2>Beacons per day</h2>
  <p class="note">Also the health check: a day far outside the others means something other than
  readers is posting. ANALYTICS_OFF=1 stops collection without a redeploy.</p>
  <table><tbody>${dayRows}</tbody></table>
</section>`;
}

// ---- one page ---------------------------------------------------------------

async function pageReport(env, request, { path, from, days, prev, qs }) {
    const where = "path = ?1 AND day >= ?2 AND prev = ?3";
    const wherePv = "pv.path = ?1 AND pv.day >= ?2 AND pv.prev = ?3";
    const binds = [path, from, prev];

    const [totals] = await query(
        env,
        `SELECT COUNT(*) AS views, COUNT(DISTINCT sess) AS sessions, AVG(engaged) AS avg_engaged,
                AVG(depth) AS avg_depth, AVG(hides) AS avg_hides, SUM(engaged) AS secs
         FROM pageviews WHERE ${where}`,
        binds,
    );

    if (!totals || num(totals.views) === 0) {
        return `<section><h2>No data for this page</h2>
<p class="note">Nothing recorded for <span class="mono">${esc(path)}</span> in the last ${days} days.</p>
<p><a href="${esc(qs({ path: null }))}">Back to all pages</a></p></section>`;
    }

    const sections = await query(
        env,
        `SELECT je.key AS section, COUNT(*) AS readers, SUM(je.value) AS secs, AVG(je.value) AS avg_secs
         FROM pageviews pv, json_each(pv.sections) je
         WHERE ${wherePv} AND pv.sections IS NOT NULL
         GROUP BY je.key ORDER BY secs DESC LIMIT 80`,
        binds,
    );
    const entries = await query(
        env,
        `SELECT sec_first AS k, COUNT(*) AS n FROM pageviews WHERE ${where} AND sec_first IS NOT NULL
         GROUP BY k ORDER BY n DESC LIMIT 12`,
        binds,
    );
    const exits = await query(
        env,
        `SELECT sec_last AS k, COUNT(*) AS n FROM pageviews WHERE ${where} AND sec_last IS NOT NULL
         GROUP BY k ORDER BY n DESC LIMIT 12`,
        binds,
    );
    const events = await query(
        env,
        `SELECT json_extract(je.value,'$[0]') AS type, json_extract(je.value,'$[1]') AS val,
                COUNT(*) AS n
         FROM pageviews pv, json_each(pv.events) je
         WHERE ${wherePv} AND pv.events IS NOT NULL
         GROUP BY type, val ORDER BY n DESC LIMIT 40`,
        binds,
    );

    const titles = await sectionTitles(env, request, path);
    const label = (id) => esc(titles.get(id) || id);

    const totalSecs = sections.reduce((sum, r) => sum + num(r.secs), 0);
    const secMax = Math.max(...sections.map((r) => num(r.secs)), 0);
    const sectionRows = sections
        .map(
            (r) => `<tr>
  <td><a href="${esc(path)}#${esc(r.section)}" target="_blank" rel="noopener">${label(r.section)}</a>
      <div class="mono dim">${esc(r.section)}</div></td>
  <td>${bar(r.secs, secMax)}</td>
  <td class="n">${pct(r.secs, totalSecs)}%</td>
  <td class="n">${pct(r.readers, totals.views)}%</td>
  <td class="n">${duration(r.avg_secs)}</td>
</tr>`,
        )
        .join("\n");

    const stack = (rows, empty) => {
        if (rows.length === 0) return `<p class="empty">${empty}</p>`;
        const max = Math.max(...rows.map((r) => num(r.n)), 0);
        return `<table><tbody>${rows
            .map(
                (r) => `<tr><td>${label(r.k)}</td><td>${bar(r.n, max)}</td>
<td class="n">${thousands(r.n)}</td><td class="n dim">${pct(r.n, totals.views)}%</td></tr>`,
            )
            .join("\n")}</tbody></table>`;
    };

    const eventLabel = {
        toc: "Contents jump",
        img: "Image opened",
        nav: "Internal link",
        out: "Outbound link",
        tab: "Path tab",
        top: "Back to top",
    };
    const eventRows = events
        .map(
            (r) => `<tr>
  <td>${esc(eventLabel[r.type] || r.type)}</td>
  <td class="mono">${esc(r.val || "-")}</td>
  <td class="n">${thousands(r.n)}</td>
</tr>`,
        )
        .join("\n");

    return `
<section>
  <h2>Last ${days} days</h2>
  <ul class="tiles">
    <li class="tile"><b>${thousands(totals.views)}</b><span>pageviews</span></li>
    <li class="tile"><b>${duration(totals.avg_engaged)}</b><span>avg time reading</span></li>
    <li class="tile"><b>${Math.round(num(totals.avg_depth))}%</b><span>avg scroll depth</span></li>
    <li class="tile"><b>${num(totals.avg_hides).toFixed(1)}</b><span>avg trips to the game</span></li>
    <li class="tile"><b>${sections.length}</b><span>sections reached</span></li>
    <li class="tile"><b>${duration(totals.secs)}</b><span>total reading time</span></li>
  </ul>
</section>

<section>
  <h2>Sections by time read</h2>
  <p class="note">"Share" is this section's cut of all the time spent on the page. "Reach" is the
  share of readers who ever scrolled it into view. A section with high reach and near-zero share is
  one people scroll straight past.</p>
  ${
      sections.length === 0
          ? '<p class="empty">No section data recorded.</p>'
          : `<table>
    <thead><tr><th>Section</th><th></th><th class="n">Share</th><th class="n">Reach</th>
    <th class="n">Avg dwell</th></tr></thead>
    <tbody>${sectionRows}</tbody>
  </table>`
  }
</section>

<div class="grid2">
  <section>
    <h2>Came in at</h2>
    <p class="note">First section on screen. On a search arrival this is what they were sent for.</p>
    ${stack(entries, "No entry points recorded.")}
  </section>
  <section>
    <h2>Stopped at</h2>
    <p class="note">Section on screen when the reader left.</p>
    ${stack(exits, "No exit points recorded.")}
  </section>
</div>

<section>
  <h2>What readers clicked</h2>
  ${
      events.length === 0
          ? '<p class="empty">No interactions recorded.</p>'
          : `<table><thead><tr><th>Action</th><th>Target</th><th class="n">Count</th></tr></thead>
  <tbody>${eventRows}</tbody></table>`
  }
</section>`;
}
