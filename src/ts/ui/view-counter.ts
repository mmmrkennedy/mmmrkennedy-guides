/**
 * View counter
 * ------------
 * Fetches the per-page hit count from the /api/views Pages Function (KV-backed)
 * and renders it into the footer's `.site-footer__views` placeholder.
 *
 * Increments once per browser session per path (sessionStorage); on later loads
 * it only reads, so refreshing a page does not inflate its count. Fails silently
 * (the placeholder stays empty and hidden) if the endpoint is unreachable.
 */
document.addEventListener("DOMContentLoaded", () => {
    const target = document.querySelector<HTMLElement>(".site-footer__views");
    if (!target) return;

    const path = normalizePath(window.location.pathname);
    const sessionKey = "viewed:" + path;
    // First sighting this session → POST (increments). Afterwards → GET (read only).
    const shouldIncrement = !sessionStorage.getItem(sessionKey);
    const endpoint = "/api/views?path=" + encodeURIComponent(path);

    fetch(endpoint, { method: shouldIncrement ? "POST" : "GET" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("HTTP " + res.status))))
        .then((data: { count?: number }) => {
            if (typeof data.count !== "number") return;
            if (shouldIncrement) {
                try {
                    sessionStorage.setItem(sessionKey, "1");
                } catch {
                    /* sessionStorage blocked (private mode) — skip dedupe, no-op */
                }
            }
            const noun = data.count === 1 ? "view" : "views";
            // Non-empty text lifts the `:empty { display:none }` rule and reveals
            // the leading "•" separator drawn via ::before.
            target.textContent = formatCount(data.count) + " " + noun;
        })
        .catch((err) => {
            console.warn("View counter unavailable:", err);
        });

    /** Mirror the server's normalization: leading slash, no trailing slash (except root). */
    function normalizePath(p: string): string {
        if (!p.startsWith("/")) p = "/" + p;
        if (p.length > 1) p = p.replace(/\/+$/, "");
        return p;
    }

    /** 1400000 → "1.4M", 12300 → "12.3K", 950 → "950". Drops a trailing ".0". */
    function formatCount(n: number): string {
        const units = [
            { value: 1000000000, suffix: "B" },
            { value: 1000000, suffix: "M" },
            { value: 1000, suffix: "K" },
        ];
        for (const u of units) {
            if (n >= u.value) {
                return (n / u.value).toFixed(1).replace(/\.0$/, "") + u.suffix;
            }
        }
        return String(n);
    }
});
