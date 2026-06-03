// Admin page for reviewing & managing guide-feedback flags.
//
//   GET  /admin/flags?status=open|resolved|dismissed|all   → HTML table
//   POST /admin/flags  (form: action,id,path,line_hash,status) → mutate + redirect
//
// Protected by HTTP Basic Auth using env vars ADMIN_USER + ADMIN_PASS (set them
// in the Cloudflare dashboard). Put Cloudflare Access in front of /admin/* too if
// you want a second layer. Requires the D1 binding `DB`.

// Keep in sync with THRESHOLD in functions/api/feedback/index.js.
const BUGGY_THRESHOLD = 5;
const STATUSES = ["open", "resolved", "dismissed"];

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

function authGate(request, env) {
    if (!env.ADMIN_USER || !env.ADMIN_PASS) return "unconfigured";
    const header = request.headers.get("Authorization") || "";
    if (header.startsWith("Basic ")) {
        let decoded = "";
        try {
            decoded = atob(header.slice(6));
        } catch {
            decoded = "";
        }
        const sep = decoded.indexOf(":");
        const user = sep === -1 ? decoded : decoded.slice(0, sep);
        const pass = sep === -1 ? "" : decoded.slice(sep + 1);
        if (user === env.ADMIN_USER && pass === env.ADMIN_PASS) return "ok";
    }
    return "unauthorized";
}

function unauthorized() {
    return new Response("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="flags admin", charset="UTF-8"' },
    });
}

function htmlResponse(body, status = 200) {
    return new Response(body, {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
}

export async function onRequestGet({ request, env }) {
    const gate = authGate(request, env);
    if (gate === "unconfigured") {
        return htmlResponse("<h1>Admin not configured</h1><p>Set ADMIN_USER and ADMIN_PASS env vars.</p>", 503);
    }
    if (gate !== "ok") return unauthorized();
    if (!env.DB) return htmlResponse("<h1>DB binding 'DB' is not configured</h1>", 500);

    const url = new URL(request.url);
    let status = url.searchParams.get("status") || "open";
    if (!STATUSES.includes(status) && status !== "all") status = "open";

    // Status counts for the nav.
    const counts = {};
    try {
        const { results } = await env.DB.prepare(
            "SELECT status, COUNT(*) AS n FROM flags GROUP BY status",
        ).all();
        for (const r of results || []) counts[r.status] = r.n;
    } catch {
        /* ignore */
    }
    const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

    // Distinct-IP buggy report counts per line, among OPEN flags (drives the note).
    const buggyByLine = new Map();
    try {
        const { results } = await env.DB.prepare(
            "SELECT path, line_hash, COUNT(DISTINCT ip_hash) AS reports FROM flags " +
                "WHERE status = 'open' AND reason = 'buggy' GROUP BY path, line_hash",
        ).all();
        for (const r of results || []) buggyByLine.set(r.path + "|" + r.line_hash, r.reports);
    } catch {
        /* ignore */
    }
    let overThreshold = 0;
    for (const n of buggyByLine.values()) if (n >= BUGGY_THRESHOLD) overThreshold++;

    // The flags themselves.
    let rows = [];
    try {
        const stmt =
            status === "all"
                ? env.DB.prepare(
                      "SELECT id, path, line_hash, quote, reason, detail, status, created_at, ip_hash " +
                          "FROM flags ORDER BY created_at DESC LIMIT 500",
                  )
                : env.DB
                      .prepare(
                          "SELECT id, path, line_hash, quote, reason, detail, status, created_at, ip_hash " +
                              "FROM flags WHERE status = ?1 ORDER BY created_at DESC LIMIT 500",
                      )
                      .bind(status);
        const { results } = await stmt.all();
        rows = results || [];
    } catch (e) {
        return htmlResponse("<h1>Query failed</h1><pre>" + esc(String(e)) + "</pre>", 500);
    }

    const navLink = (key, label) => {
        const n = key === "all" ? totalAll : counts[key] || 0;
        const active = key === status ? ' class="active"' : "";
        return `<a${active} href="?status=${key}">${label} <span class="badge">${n}</span></a>`;
    };

    const reasonLabel = {
        unclear: "Doesn’t make sense",
        outdated: "Out of date",
        wrong: "Incorrect",
        buggy: "Doesn’t work / buggy",
    };

    const rowsHtml = rows
        .map((r) => {
            const reports = r.reason === "buggy" ? buggyByLine.get(r.path + "|" + r.line_hash) || 0 : 0;
            const hot = reports >= BUGGY_THRESHOLD;
            const reportBadge =
                r.reason === "buggy"
                    ? ` <span class="reports${hot ? " hot" : ""}" title="distinct IPs reporting this line as buggy (open)">${reports}${hot ? " ⚠ noted" : ""}</span>`
                    : "";
            const btn = (action, label, extra = "") =>
                `<button name="action" value="${action}"${extra}>${label}</button>`;
            const actions =
                (r.status === "open"
                    ? btn("resolve", "Resolve") + btn("dismiss", "Dismiss")
                    : btn("reopen", "Reopen")) +
                btn("resolve_line", "Resolve line", ' title="resolve all open flags on this exact line"') +
                btn("delete", "Delete", ' class="danger" onclick="return confirm(\'Delete this flag permanently?\')"');
            return `<tr class="r-${esc(r.status)}">
  <td class="mono">${esc(r.created_at)}</td>
  <td><a href="${esc(r.path)}" target="_blank" rel="noopener">${esc(r.path)}</a><div class="mono dim">${esc(r.line_hash)}</div></td>
  <td><span class="reason reason-${esc(r.reason)}">${esc(reasonLabel[r.reason] || r.reason)}</span>${reportBadge}</td>
  <td class="quote">${esc(r.quote)}</td>
  <td class="detail">${esc(r.detail)}</td>
  <td><span class="status status-${esc(r.status)}">${esc(r.status)}</span></td>
  <td class="actions">
    <form method="post">
      <input type="hidden" name="id" value="${esc(r.id)}">
      <input type="hidden" name="path" value="${esc(r.path)}">
      <input type="hidden" name="line_hash" value="${esc(r.line_hash)}">
      <input type="hidden" name="status" value="${esc(status)}">
      ${actions}
    </form>
  </td>
</tr>`;
        })
        .join("\n");

    const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Flags admin</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#15171b;color:#e8e8ea;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  header{padding:1rem 1.25rem;border-bottom:1px solid #2a2e35;position:sticky;top:0;background:#15171b;z-index:2}
  h1{margin:0 0 .5rem;font-size:1.15rem}
  nav{display:flex;gap:.5rem;flex-wrap:wrap}
  nav a{color:#cbd2dd;text-decoration:none;padding:.25rem .6rem;border:1px solid #2a2e35;border-radius:999px}
  nav a.active{border-color:#6ea8fe;color:#fff;background:#1d2733}
  .badge{opacity:.7;font-size:.8em}
  .summary{padding:.5rem 1.25rem;color:#f1b86b;font-size:.9rem}
  table{border-collapse:collapse;width:100%}
  th,td{padding:.5rem .6rem;border-bottom:1px solid #23272e;vertical-align:top;text-align:left}
  th{position:sticky;top:5.4rem;background:#191c21;font-weight:600;color:#aeb6c2}
  tr:hover{background:#1a1d23}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82em}
  .dim{opacity:.5}
  .quote{max-width:22ch;color:#aeb6c2}
  .detail{max-width:34ch;white-space:pre-wrap}
  .reason{font-size:.85em;white-space:nowrap}
  .reason-buggy{color:#ff8d8d}.reason-wrong{color:#ffb27a}.reason-outdated{color:#e7c86a}.reason-unclear{color:#9fc6ff}
  .reports{display:inline-block;margin-left:.3rem;padding:0 .4rem;border-radius:999px;background:#2a2e35;font-size:.8em}
  .reports.hot{background:#5a1f1f;color:#ffd2d2}
  .status{font-size:.8em;padding:.05rem .45rem;border-radius:999px;border:1px solid #2a2e35}
  .status-open{color:#ffd2d2;border-color:#5a1f1f}.status-resolved{color:#bdebc4;border-color:#244a2c}.status-dismissed{opacity:.6}
  .actions form{display:flex;gap:.25rem;flex-wrap:wrap}
  button{background:#222732;color:#dfe5ee;border:1px solid #323844;border-radius:6px;padding:.2rem .5rem;font:inherit;font-size:.82em;cursor:pointer}
  button:hover{border-color:#6ea8fe}
  button.danger:hover{border-color:#ff6b6b;color:#ff9d9d}
  .empty{padding:2rem 1.25rem;opacity:.6}
</style></head>
<body>
<header>
  <h1>Guide feedback — flags</h1>
  <nav>
    ${navLink("open", "Open")}
    ${navLink("resolved", "Resolved")}
    ${navLink("dismissed", "Dismissed")}
    ${navLink("all", "All")}
  </nav>
</header>
${overThreshold ? `<div class="summary">⚠ ${overThreshold} line${overThreshold === 1 ? "" : "s"} currently over the buggy threshold (${BUGGY_THRESHOLD}) — auto-noted to readers.</div>` : ""}
${
    rows.length === 0
        ? `<p class="empty">No ${status === "all" ? "" : esc(status) + " "}flags.</p>`
        : `<table>
<thead><tr><th>When (UTC)</th><th>Page / line</th><th>Reason</th><th>Quote</th><th>Detail</th><th>Status</th><th>Actions</th></tr></thead>
<tbody>
${rowsHtml}
</tbody></table>`
}
</body></html>`;

    return htmlResponse(page);
}

export async function onRequestPost({ request, env }) {
    const gate = authGate(request, env);
    if (gate === "unconfigured") return htmlResponse("<h1>Admin not configured</h1>", 503);
    if (gate !== "ok") return unauthorized();
    if (!env.DB) return htmlResponse("<h1>DB binding 'DB' is not configured</h1>", 500);

    const form = await request.formData();
    const action = form.get("action");
    const id = parseInt(form.get("id"), 10);
    const path = form.get("path");
    const lineHash = form.get("line_hash");
    let status = form.get("status") || "open";
    if (!STATUSES.includes(status) && status !== "all") status = "open";

    try {
        if (action === "resolve" && Number.isFinite(id)) {
            await env.DB.prepare("UPDATE flags SET status='resolved' WHERE id=?1").bind(id).run();
        } else if (action === "dismiss" && Number.isFinite(id)) {
            await env.DB.prepare("UPDATE flags SET status='dismissed' WHERE id=?1").bind(id).run();
        } else if (action === "reopen" && Number.isFinite(id)) {
            await env.DB.prepare("UPDATE flags SET status='open' WHERE id=?1").bind(id).run();
        } else if (action === "delete" && Number.isFinite(id)) {
            await env.DB.prepare("DELETE FROM flags WHERE id=?1").bind(id).run();
        } else if (action === "resolve_line" && path && lineHash) {
            await env.DB
                .prepare("UPDATE flags SET status='resolved' WHERE path=?1 AND line_hash=?2 AND status='open'")
                .bind(path, lineHash)
                .run();
        }
    } catch {
        /* fall through to redirect; the list will reflect reality */
    }

    const dest = new URL("/admin/flags?status=" + encodeURIComponent(status), request.url).href;
    return new Response(null, { status: 303, headers: { Location: dest } });
}
