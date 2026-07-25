"use strict";
/**
 * Relative time
 * -------------
 * Re-renders the footer's ages against the reader's own clock: the visible
 * "Updated 3 days ago", and the "Released 2 years ago" tooltip on the initial
 * release date.
 *
 * The build bakes both strings into the page (see the `lastmodRelative` and
 * `releasedRelative` filters in eleventy.config.cjs), but that text ages with the
 * deploy: a guide edited yesterday still reads "yesterday" three weeks later. This
 * reads the machine-readable `datetime` attribute and rewrites on load, so the
 * baked-in string only ever shows to readers without JS.
 *
 * The release date itself is absolute and never rewritten; only the tooltip that
 * says how long ago it was.
 *
 * The bucket ladder here must match `formatRelativeDate` in eleventy.config.cjs,
 * or pages would visibly flip wording the moment the script runs.
 */
document.addEventListener("DOMContentLoaded", () => {
    const updated = document.querySelectorAll("time[datetime].site-footer__updated");
    const released = document.querySelectorAll("time[datetime].site-footer__released");
    if (updated.length === 0 && released.length === 0)
        return;
    const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    updated.forEach((node) => {
        const days = daysSince(node.dateTime);
        if (days === null)
            return;
        node.textContent = "Updated " + relative(days);
    });
    released.forEach((node) => {
        const days = daysSince(node.dateTime);
        if (days === null)
            return;
        node.title = "Released " + relative(days);
    });
    /**
     * Whole days between a "YYYY-MM-DD" attribute and the reader's local calendar
     * date. Both sides are reinterpreted as UTC so the subtraction is pure date
     * arithmetic, so no timezone offset or DST hour can shift the result by a day.
     * Null if the attribute isn't a bare calendar date.
     */
    function daysSince(datetime) {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(datetime);
        if (!match)
            return null;
        const then = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const now = new Date();
        const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.max(0, Math.round((today - then) / 86400000));
    }
    /** 0 → "today", 3 → "3 days ago", 40 → "last month". */
    function relative(days) {
        if (days < 1)
            return "today";
        if (days < 7)
            return fmt.format(-days, "day");
        if (days < 31)
            return fmt.format(-Math.round(days / 7), "week");
        if (days < 365)
            return fmt.format(-Math.max(1, Math.round(days / 30.44)), "month");
        return fmt.format(-Math.max(1, Math.round(days / 365.25)), "year");
    }
});
