/**
 * Inlines only the CSS rules each page can use and drops the <link>s. Edits dist only.
 * Solvers.css is not owned: it is already non-blocking on guides, and solver
 * markup is rendered by React.
 * CSS_FALLBACK=true also keeps the full bundle as a deferred link.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postcss from "postcss";
import { JSDOM } from "jsdom";
import { minify } from "terser";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const KEEP_FALLBACK = process.env.CSS_FALLBACK === "true";

// Patterns because minify-assets.js has already hashed the names.
const OWNED = [
    /^\/css\/bundle\.[0-9a-f]+\.min\.css$/,
    /^\/css\/index-nav\.[0-9a-f]+\.css$/,
    /^\/css\/trending\.[0-9a-f]+\.css$/,
    /^\/css\/stats\.[0-9a-f]+\.css$/,
];

const SKIP_PAGES = [/^react-solvers[/\\]/];

/**
 * Scripts a page switches off, so their classes are purged there. Gates name a
 * script, not a class prefix: a class survives if any enabled script can add it
 * (index-filter.ts borrows .gfb-toast). Each gate must match an early return in
 * the script it names.
 */
const FEATURE_GATES = [
    { disabled: (body) => body.hasAttribute("data-no-flags"), scripts: [/ui[/\\]line-flagger\.js$/] },
    { disabled: (body) => body.dataset.skipToc === "true", scripts: [/content[/\\]quick-links\.js$/] },
    // No early return to point at: guide-controls.ts just finds nothing to wire up.
    { disabled: (body) => !body.querySelector(".path-tabs"), scripts: [/content[/\\]guide-controls\.js$/] },
];

function findFiles(dir, ext) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...findFiles(full, ext));
        else if (entry.name.endsWith(ext)) out.push(full);
    }
    return out;
}

// Runtime-built classes the patterns can't see (ads.ts: `ads-${mode}`). Add here
// rather than widening the patterns.
const SAFELIST = ["ads-full", "ads-hidden", "ads-minimal"];

/**
 * Only class-bearing sites are scanned: scanning every string literal kept 71% of
 * the CSS, since minified code is full of words like "active" that are also classes.
 * The React solver bundle is included because it uses core classes that no static
 * markup carries.
 */
async function harvestJsTokens() {
    const byFile = new Map([["(safelist)", new Set(SAFELIST)]]);
    const classish = /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/;

    let tokens;
    const add = (value) => {
        if (!value) return;
        for (const part of value.split(/\s+/)) {
            if (classish.test(part)) tokens.add(part);
        }
    };

    // src/ts, not the dist/js bundles: FEATURE_GATES needs tokens per script.
    const tsRoot = path.join(distDir, "..", "src", "ts");
    // Minified because the patterns were tuned against minified code.
    const scripts = await Promise.all(
        findFiles(tsRoot, ".ts")
            .filter((f) => !f.endsWith(".d.ts"))
            .map(async (f) => {
                const js = ts.transpileModule(fs.readFileSync(f, "utf8"), {
                    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 },
                }).outputText;
                const { code } = await minify(js, { compress: true, mangle: true });
                return { key: path.join("js", path.relative(tsRoot, f)).replace(/\.ts$/, ".js"), code };
            }),
    );
    const sources = [
        ...scripts,
        ...(fs.existsSync(path.join(distDir, "react-solvers"))
            ? findFiles(path.join(distDir, "react-solvers"), ".js").map((f) => ({
                  key: path.relative(distDir, f),
                  code: fs.readFileSync(f, "utf8"),
              }))
            : []),
    ];

    const classListCall = /classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g;
    // The `:` forms are compiled JSX.
    const assignment = /(?:className|\bclass)\s*[=:]\s*(["'`])([^"'`\n]*)\1/g;
    const setAttr = /setAttribute\s*\(\s*["'`]class["'`]\s*,\s*["'`]([^"'`\n]*)["'`]/g;
    // class attributes inside innerHTML/template blobs.
    const markupClass = /class=(?:\\?["'])([^"'\\\n]*)(?:\\?["'])/g;
    // Selector strings the JS queries with.
    const selectorish = /["'`]([^"'`\n]*[.#][a-zA-Z_-][^"'`\n]*)["'`]/g;

    for (const { key, code } of sources) {
        tokens = new Set();
        let m;

        while ((m = classListCall.exec(code)) !== null) {
            for (const s of m[1].matchAll(/["'`]([^"'`\n]*)["'`]/g)) add(s[1]);
        }
        while ((m = assignment.exec(code)) !== null) add(m[2]);
        while ((m = setAttr.exec(code)) !== null) add(m[1]);
        while ((m = markupClass.exec(code)) !== null) add(m[1]);
        while ((m = selectorish.exec(code)) !== null) {
            for (const t of selectorTokens(m[1])) tokens.add(t);
        }

        byFile.set(key.replace(/\\/g, "/"), tokens);
    }

    return byFile;
}

function harvestPageTokens(doc) {
    const tokens = new Set();
    for (const el of doc.querySelectorAll("*")) {
        for (const c of el.classList) tokens.add(c);
        if (el.id) tokens.add(el.id);
    }
    return tokens;
}

/**
 * Pseudo-class arguments count on purpose: keeping a `:not(.dummy-li)` rule on a
 * page with the class is harmless, dropping it is not.
 */
function selectorTokens(selector) {
    const found = [];
    const pattern = /[.#](-?[a-zA-Z_][a-zA-Z0-9_-]*)/g;
    let m;
    while ((m = pattern.exec(selector)) !== null) found.push(m[1]);
    return found;
}

function purge(css, tokens) {
    const ast = postcss.parse(css);

    ast.walkRules((rule) => {
        // Keyframe steps aren't selectors; @keyframes blocks are always kept.
        if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) return;

        const kept = rule.selectors.filter((sel) =>
            selectorTokens(sel).every((t) => tokens.has(t))
        );

        if (kept.length === 0) rule.remove();
        else if (kept.length !== rule.selectors.length) rule.selectors = kept;
    });

    ast.walkAtRules((at) => {
        if (/font-face|keyframes|charset|import|property/i.test(at.name)) return;
        if (at.nodes && at.nodes.length === 0) at.remove();
    });

    return ast.toString();
}

const jsTokens = await harvestJsTokens();

const rows = [];
let inlinedTotal = 0;
let sourceTotal = 0;

for (const file of findFiles(distDir, ".html")) {
    const rel = path.relative(distDir, file).replace(/\\/g, "/");
    if (SKIP_PAGES.some((p) => p.test(rel))) continue;

    const html = fs.readFileSync(file, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // A media="print" link is already off the critical path.
    const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter(
        (l) => !l.media && OWNED.some((p) => p.test(new URL(l.href, "https://x/").pathname))
    );
    if (links.length === 0) continue;

    const tokens = harvestPageTokens(doc);
    const off = FEATURE_GATES.filter((g) => g.disabled(doc.body)).flatMap((g) => g.scripts);

    for (const [file, fileTokens] of jsTokens) {
        if (off.some((rx) => rx.test(file))) continue;
        for (const token of fileTokens) tokens.add(token);
    }

    // Document order keeps the cascade: index-nav.css and trending.css must follow
    // the bundle (see css/styles.css).
    const sources = links.map((l) => {
        const p = new URL(l.href, "https://x/").pathname;
        return fs.readFileSync(path.join(distDir, p), "utf8");
    });

    const source = sources.join("\n");
    const purged = purge(source, tokens);

    const style = doc.createElement("style");
    style.textContent = purged;
    links[0].replaceWith(style);

    for (const link of links.slice(1)) link.remove();

    if (KEEP_FALLBACK) {
        const fallback = doc.createElement("link");
        fallback.rel = "stylesheet";
        fallback.href = links[0].getAttribute("href");
        fallback.media = "print";
        fallback.setAttribute("onload", "this.media='all';this.onload=null");
        style.after(fallback);
    }

    fs.writeFileSync(file, dom.serialize(), "utf8");

    sourceTotal += source.length;
    inlinedTotal += purged.length;
    rows.push({
        page: rel,
        pct: Math.round((purged.length / source.length) * 100),
        kb: (purged.length / 1024).toFixed(1),
    });
}

if (rows.length === 0) {
    console.log("inline-critical-css: no page linked an owned stylesheet — nothing to do");
} else {
    rows.sort((a, b) => b.pct - a.pct);
    const mean = Math.round((inlinedTotal / sourceTotal) * 100);
    const worst = rows[0];
    const best = rows[rows.length - 1];
    console.log(
        `Inlined CSS on ${rows.length} pages — kept ${mean}% of source ` +
        `(most ${worst.pct}% ${worst.page}, least ${best.pct}% ${best.page})` +
        (KEEP_FALLBACK ? " + deferred fallback link" : "")
    );
}
