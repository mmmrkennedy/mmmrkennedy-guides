// Link targets classifyLinks understands. Anything with an extension outside
// VALID_EXTS is a typo worth warning about; the LIGHTBOX_* sets decide which
// ones open in the lightbox and as what.
const VALID_EXTS = [".webp", ".html", ".webm", ".gif", ".jpg", ".jpeg", ".png", ".mp4", ".mov", ".flac", ".mp3", ".ogg", ".wav", ".m4a"];
const LIGHTBOX_EXTS = new Set([".webp", ".jpg", ".jpeg", ".png", ".gif", ".webm", ".mp4", ".mov", ".flac", ".mp3", ".ogg", ".wav", ".m4a"]);
const LIGHTBOX_VIDEO_EXTS = new Set([".webm", ".mp4", ".mov"]);
const LIGHTBOX_AUDIO_EXTS = new Set([".flac", ".mp3", ".ogg", ".wav", ".m4a"]);

/** Adds link-type classes, lightbox attributes and external link safety attributes. */
function classifyLinks(content, outputPath) {
    if (!outputPath || !outputPath.endsWith(".html")) return content;

    try {
        let modified = false;

        const result = content.replace(/<a(\s[^>]*)>/gi, (match, attrs) => {
            const hrefMatch = /href=["']([^"']*)["']/i.exec(attrs);
            if (!hrefMatch) return match;
            const href = hrefMatch[1];
            let overrideHref = null;

            const classMatch = /class=["']([^"']*)["']/i.exec(attrs);
            const existing = new Set(classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : []);
            const sizeBefore = existing.size;

            if (href.includes("#")) {
                if (href.startsWith("#")) {
                    existing.add("link-to-page");
                } else {
                    existing.add("internal-link");
                }
            }

            // Anything with a scheme, or protocol-relative, plus the bare
            // hostnames ("example.com/foo") authors write without one.
            const isExternal = /^(?:[a-z]+:)?\/\//i.test(href) ||
                (href.includes(".com") && !href.startsWith("/"));

            if (isExternal) existing.add("external-link");

            // Keeps any existing target and merges rel tokens.
            let needsTarget = false;
            let computedRel = null;
            if (isExternal) {
                needsTarget = !/\btarget=["'][^"']*["']/i.test(attrs);
                const relMatch = /\brel=["']([^"']*)["']/i.exec(attrs);
                const relTokens = new Set(relMatch ? relMatch[1].split(/\s+/).filter(Boolean) : []);
                const required = ["noopener", "noreferrer", "nofollow"];
                const missing = required.filter((r) => !relTokens.has(r));
                if (missing.length > 0) {
                    for (const r of required) relTokens.add(r);
                    computedRel = [...relTokens].join(" ");
                }
            }

            if (!href.startsWith("#") && !href.startsWith("http")) {
                // A trailing slash means a half-written link (`pictures/foo/`),
                // except "/" on its own, which is the site root.
                if (href.endsWith("/") && href !== "/") {
                    existing.add("incomplete-path");
                    overrideHref = "#";
                    console.warn(`Incomplete path in ${outputPath}: ${href}`);
                } else {
                    const pathWithoutQuery = href.split("?")[0];
                    const hasUnknownExt = /\.[a-z0-9]+$/i.test(pathWithoutQuery);
                    const hasKnownExt = VALID_EXTS.some((ext) => pathWithoutQuery.toLowerCase().endsWith(ext));
                    if (hasUnknownExt && !hasKnownExt) {
                        console.warn(`Invalid file type in ${outputPath}: ${href}`);
                    }
                }
            }

            const hrefLower = href.toLowerCase().split("?")[0];
            const hrefExt = hrefLower.match(/\.[a-z0-9]+$/)?.[0];
            let dataMediaType = null;
            if (hrefExt && LIGHTBOX_EXTS.has(hrefExt)) {
                existing.add("lightbox-trigger");
                dataMediaType = LIGHTBOX_VIDEO_EXTS.has(hrefExt)
                    ? "video"
                    : LIGHTBOX_AUDIO_EXTS.has(hrefExt)
                        ? "audio"
                        : "image";
            }

            if (
                existing.size === sizeBefore &&
                overrideHref === null &&
                dataMediaType === null &&
                !needsTarget &&
                computedRel === null
            ) return match;

            modified = true;
            const classStr = [...existing].join(" ");
            let newAttrs = classMatch
                ? attrs.replace(/class=["'][^"']*["']/i, `class="${classStr}"`)
                : ` class="${classStr}"${attrs}`;
            if (overrideHref !== null) {
                newAttrs = newAttrs.replace(/href=["'][^"']*["']/i, `href="${overrideHref}"`);
            }
            if (dataMediaType !== null && !/data-media-type=/i.test(newAttrs)) {
                newAttrs += ` data-media-type="${dataMediaType}"`;
            }
            if (needsTarget) {
                newAttrs += ` target="_blank"`;
            }
            if (computedRel !== null) {
                if (/\brel=["'][^"']*["']/i.test(newAttrs)) {
                    newAttrs = newAttrs.replace(/\brel=["'][^"']*["']/i, `rel="${computedRel}"`);
                } else {
                    newAttrs += ` rel="${computedRel}"`;
                }
            }
            return `<a${newAttrs}>`;
        });

        return modified ? result : content;
    } catch (error) {
        console.error(`Error classifying links in ${outputPath}:`, error.message);
        return content;
    }
}

/**
 * Links to unwritten guides are authored as `<a class="disabled" href="...">`.
 * Renaming href to data-href means they can't be followed or focused, and crawlers
 * don't see them. Runs last, so classifyLinks still sees the real href.
 */
function unlinkUnwrittenGuides(content, outputPath) {
    if (!outputPath?.endsWith(".html")) return content;
    if (!content.includes("disabled")) return content;

    let modified = false;
    const result = content.replace(/<a\s[^>]*>/gi, (tag) => {
        // Exact class token only: `btn--disabled` must not match.
        const classAttr = /\sclass=["']([^"']*)["']/i.exec(tag);
        if (!classAttr || !classAttr[1].split(/\s+/).includes("disabled")) return tag;
        // `\s` before href so an already-renamed data-href is left alone.
        if (!/\shref=/i.test(tag)) return tag;
        modified = true;
        return tag.replace(/(\s)href=/i, "$1data-href=");
    });
    return modified ? result : content;
}

module.exports = { classifyLinks, unlinkUnwrittenGuides };
