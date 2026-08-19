/**
 * Per-page CSS: keep what the page can actually use, inline it, drop the link.
 *
 * Lighthouse flagged three render-blocking stylesheets on the homepage
 * (bundle.min.css, index-nav.css, trending.css) for ~150ms. They block because
 * the browser cannot paint until they arrive, and the last two are not even
 * discovered until the HTML has been parsed.
 *
 * Measured before writing this: the mean page matches 45% of the bundle's rules
 * (index 21%, the heaviest guide 61%). So most of what every page waits for is
 * rules it can never apply. This step computes the used subset per page, emits
 * it as a <style> in the <head> where the first <link> was, and removes the
 * links it replaced. A cold page load then needs zero CSS requests.
 *
 * The cost: CSS stops being a separately cached file. _headers gives CSS 30
 * days and HTML 300s, so today a second pageview re-uses the bundle for free,
 * while inlined CSS rides along with every navigation (mean +4.8KB gzip).
 * Break-even is around two pageviews per session; search traffic lands on one
 * guide and leaves, so cold load is the case worth optimising.
 *
 * WHAT IS NOT TOUCHED
 *   - Solvers.css. On guide pages it is already non-blocking (media=print), and
 *     on solver pages the markup is React's, so a static purge cannot see the
 *     classes that appear once the user interacts. Left exactly as it is.
 *   - react-solvers/index.html, the Vite dev harness, which is not a real page.
 *   - The templates. They keep emitting <link> tags, which dev mode needs and
 *     minify-assets.js's orphan check counts. This step edits dist only.
 *
 * SAFETY
 * A purge is only as good as its idea of what "used" means, and half this site's
 * classes are added at runtime: ad slots, the feedback flags (gfb-*), the
 * sidebar TOC, the return pill, every is-* state class. None of them appear in
 * the built HTML. So the token set is the page's own classes and ids PLUS every
 * class-shaped string literal and markup fragment found in the shipped JS.
 *
 * A rule survives when every class and id its selector names is in that set —
 * the PurgeCSS rule, chosen over live DOM matching because it cannot be fooled
 * by structure that only exists after a click. Rules naming no class or id at
 * all (element and attribute selectors, :root, @font-face, @keyframes) are
 * always kept: they are a small share of the bytes and the cheapest thing to be
 * wrong about.
 *
 * Set CSS_FALLBACK=true to additionally keep the full bundle as a deferred
 * (media=print, non-blocking) link. It re-supplies anything wrongly dropped,
 * landing after the inline <style> so the cascade order is unchanged. Off by
 * default, deliberately: with the net in place a purge bug is invisible, and
 * the point of a preview deploy is to see the real thing.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postcss from "postcss";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

const KEEP_FALLBACK = process.env.CSS_FALLBACK === "true";

// Sheets this step owns. Anything else a page links is left alone.
// Hashed by minify-assets.js before we run, hence the pattern rather than a
// literal name.
const OWNED = [
    /^\/css\/bundle\.[0-9a-f]+\.min\.css$/,
    /^\/css\/index-nav\.[0-9a-f]+\.css$/,
    /^\/css\/trending\.[0-9a-f]+\.css$/,
    /^\/css\/stats\.[0-9a-f]+\.css$/,
];

const SKIP_PAGES = [/^react-solvers[/\\]/];

/**
 * Runtime features a page has switched off, and the class prefixes that become
 * unreachable when it does.
 *
 * The JS safelist is global — it cannot tell that the flag UI never runs on the
 * homepage — so without this the index carries every gfb-* rule for a feature
 * its own <body data-no-flags> disables. That was ~7KB of the index's inlined
 * CSS, all of it in front of the LCP element.
 *
 * Each gate must correspond to an early return in the script that owns the
 * classes, so the CSS cannot be wanted after all: data-no-flags is
 * line-flagger.ts:140, data-skip-toc is quick-links.ts:129 (and the Eleventy
 * transform that pre-renders the same markup).
 */
const FEATURE_GATES = [
    { disabled: (body) => body.hasAttribute("data-no-flags"), prefixes: ["gfb-"] },
    { disabled: (body) => body.dataset.skipToc === "true", prefixes: ["sidebar-toc", "quick-links"] },
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

// Classes the patterns below cannot see, because the JS builds them at runtime.
// ads.ts does `classList.add(\`ads-${mode}\`)`. Add to this list rather than
// widening the patterns, so each exception stays traceable to a line of source.
const SAFELIST = ["ads-full", "ads-hidden", "ads-minimal"];

/**
 * Every class-shaped token the shipped JS could put on an element, or look for.
 *
 * Scanning every string literal was the first attempt and kept 71% of the CSS:
 * minified code is full of words like "active" and "danger" that are also class
 * names, so the safelist swallowed most of the savings. This reads only the
 * places a class can actually come from — classList calls, className and class
 * assignments, class attributes inside markup blobs, and selector strings the JS
 * queries with — which is tight enough to be worth purging against and still
 * covers everything added after page load.
 *
 * The React solver bundle is included: it lives outside dist/js and its
 * components use core classes (btn, table-scroll) that no static markup carries
 * until the solver has rendered.
 */
function harvestJsTokens() {
    const tokens = new Set(SAFELIST);
    const classish = /^-?[a-zA-Z_][a-zA-Z0-9_-]*$/;

    const add = (value) => {
        if (!value) return;
        for (const part of value.split(/\s+/)) {
            if (classish.test(part)) tokens.add(part);
        }
    };

    const sources = [
        ...findFiles(path.join(distDir, "js"), ".js"),
        ...(fs.existsSync(path.join(distDir, "react-solvers"))
            ? findFiles(path.join(distDir, "react-solvers"), ".js")
            : []),
    ];

    // Quoted strings passed to classList.add/remove/toggle/contains/replace.
    const classListCall = /classList\s*\.\s*(?:add|remove|toggle|contains|replace)\s*\(([^)]*)\)/g;
    // className = "...", class: "..." and className: "..." (the compiled JSX form).
    const assignment = /(?:className|\bclass)\s*[=:]\s*(["'`])([^"'`\n]*)\1/g;
    // setAttribute("class", "..."), whichever quote style survived minification.
    const setAttr = /setAttribute\s*\(\s*["'`]class["'`]\s*,\s*["'`]([^"'`\n]*)["'`]/g;
    // class attributes inside innerHTML/template blobs, including escaped quotes.
    const markupClass = /class=(?:\\?["'])([^"'\\\n]*)(?:\\?["'])/g;
    // Any string that reads as a CSS selector, i.e. what the JS queries for.
    const selectorish = /["'`]([^"'`\n]*[.#][a-zA-Z_-][^"'`\n]*)["'`]/g;

    for (const file of sources) {
        const code = fs.readFileSync(file, "utf8");
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
    }

    return tokens;
}

/** Classes and ids present in the built markup. */
function harvestPageTokens(doc) {
    const tokens = new Set();
    for (const el of doc.querySelectorAll("*")) {
        for (const c of el.classList) tokens.add(c);
        if (el.id) tokens.add(el.id);
    }
    return tokens;
}

/**
 * The classes and ids a selector requires. Pseudo-element/class arguments are
 * included on purpose: `:not(.dummy-li)` only matters on pages that have the
 * class, but keeping the rule there is harmless and dropping it is not.
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
        // Keyframe steps (`from`, `50%`) are not selectors — their parent
        // @keyframes block lives or dies as a unit, and we always keep it.
        if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) return;

        const kept = rule.selectors.filter((sel) =>
            selectorTokens(sel).every((t) => tokens.has(t))
        );

        if (kept.length === 0) rule.remove();
        else if (kept.length !== rule.selectors.length) rule.selectors = kept;
    });

    // A @media block whose every rule went away is dead weight.
    ast.walkAtRules((at) => {
        if (/font-face|keyframes|charset|import|property/i.test(at.name)) return;
        if (at.nodes && at.nodes.length === 0) at.remove();
    });

    return ast.toString();
}

const jsTokens = harvestJsTokens();

const rows = [];
let inlinedTotal = 0;
let sourceTotal = 0;

for (const file of findFiles(distDir, ".html")) {
    const rel = path.relative(distDir, file).replace(/\\/g, "/");
    if (SKIP_PAGES.some((p) => p.test(rel))) continue;

    const html = fs.readFileSync(file, "utf8");
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Only sheets we own, and only while they are still render-blocking: a
    // media="print" link is already off the critical path.
    const links = [...doc.querySelectorAll('link[rel="stylesheet"]')].filter(
        (l) => !l.media && OWNED.some((p) => p.test(new URL(l.href, "https://x/").pathname))
    );
    if (links.length === 0) continue;

    // Page markup wins over every gate below: if the class is really on the
    // page, the rule stays whatever the feature flags say.
    const pageTokens = harvestPageTokens(doc);
    const tokens = new Set([...pageTokens, ...jsTokens]);

    for (const gate of FEATURE_GATES) {
        if (!gate.disabled(doc.body)) continue;
        for (const token of tokens) {
            if (pageTokens.has(token)) continue;
            if (gate.prefixes.some((p) => token.startsWith(p))) tokens.delete(token);
        }
    }

    // Concatenated in document order so the cascade the templates set up
    // survives: index-nav.css and trending.css are written to sit after the
    // bundle (see the note in css/styles.css) and must stay there.
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
