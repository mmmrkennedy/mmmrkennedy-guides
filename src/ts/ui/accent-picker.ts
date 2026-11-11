/**
 * Presets set <html data-accent="id"> (the :root[data-accent] blocks in tokens.css);
 * the default has no attribute. A custom colour is data-accent="custom" plus the
 * derived tokens inline on <html>, derived the same way the presets were built.
 * The inline head script in base.njk re-applies the saved vars before first paint,
 * so it needs no maths.
 * Fonts work the same way through <html data-font> (reset.css); the default has none.
 */
const ACCENT_KEY = "accent";
const FONT_KEY = "font";
const CUSTOM_KEY = "accent-custom";
const OPEN_KEY = "accent-picker-open";
const CUSTOM_ID = "custom";
const VARS = ["--color-tier-1", "--color-tier-2", "--color-tier-3", "--color-accent-bright"] as const;
const PAGE_BG = "#1a1a1a"; // --color-bg-primary
const MIN_CONTRAST = 4.5;

type Hsl = [h: number, s: number, l: number];

function save(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        // Storage blocked (private window, site data off): the pick still applies to this page.
    }
}

function load(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function normaliseHex(raw: string): string | null {
    let h = raw.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{3}$/.test(h)) h = h.replace(/./g, (c) => c + c);
    return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function hexToHsl(hex: string): Hsl {
    const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return [h, s * 100, l * 100];
}

function hslToHex([h, s, l]: Hsl): string {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

function luminance(hex: string): number {
    const [r, g, b] = hexToRgb(hex).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readable([h, s, l]: Hsl): string {
    let hex = hslToHex([h, s, l]);
    while (contrast(hex, PAGE_BG) < MIN_CONTRAST && l < 100) {
        l += 1;
        hex = hslToHex([h, s, l]);
    }
    return hex;
}

function derive(hex: string): Record<(typeof VARS)[number], string> {
    const [h, s, l] = hexToHsl(hex);
    return {
        "--color-tier-1": readable([h, s, l]),
        "--color-tier-2": readable([h, s * 0.9, clamp(l - 7, 0, 100)]),
        "--color-tier-3": readable([h, s * 0.55, clamp(l - 9, 0, 100)]),
        "--color-accent-bright": readable([h, s, clamp(l + 6, 0, 95)]),
    };
}

document.addEventListener("DOMContentLoaded", () => {
    const picker = document.querySelector<HTMLElement>(".accent-picker");
    if (!picker) return;

    const root = document.documentElement;
    const toggle = picker.querySelector<HTMLButtonElement>(".accent-picker__toggle");
    const options = Array.from(picker.querySelectorAll<HTMLButtonElement>(".accent-picker__option"));
    const colorInput = picker.querySelector<HTMLInputElement>(".accent-picker__color");
    const hexInput = picker.querySelector<HTMLInputElement>(".accent-picker__hex");
    const defaultId = options[0]?.dataset.accent ?? "";
    const fontOptions = Array.from(picker.querySelectorAll<HTMLButtonElement>(".accent-picker__font"));
    const defaultFont = fontOptions[0]?.dataset.font ?? "";

    const current = () => root.dataset.accent || defaultId;

    const sync = () => {
        const cur = current();
        for (const opt of options) opt.setAttribute("aria-pressed", String(opt.dataset.accent === cur));
        const font = root.dataset.font || defaultFont;
        for (const opt of fontOptions) opt.setAttribute("aria-pressed", String(opt.dataset.font === font));
        toggle?.setAttribute("aria-expanded", String(root.dataset.accentPicker === "open"));
    };

    const clearCustom = () => {
        for (const v of VARS) root.style.removeProperty(v);
    };

    const setOpen = (open: boolean) => {
        if (open) root.dataset.accentPicker = "open";
        else delete root.dataset.accentPicker;
        save(OPEN_KEY, open ? "1" : null);
        sync();
    };

    const applyCustom = (hex: string) => {
        const vars = derive(hex);
        for (const v of VARS) root.style.setProperty(v, vars[v]);
        root.dataset.accent = CUSTOM_ID;
        save(ACCENT_KEY, CUSTOM_ID);
        save(CUSTOM_KEY, JSON.stringify({ hex, vars }));
        sync();
    };

    try {
        const saved = JSON.parse(load(CUSTOM_KEY) ?? "null") as { hex?: string } | null;
        const hex = saved?.hex && normaliseHex(saved.hex);
        if (hex) {
            if (colorInput) colorInput.value = hex;
            if (hexInput) hexInput.value = hex;
        }
    } catch {
        // Corrupt entry: leave the inputs at their defaults.
    }

    toggle?.addEventListener("click", () => setOpen(root.dataset.accentPicker !== "open"));

    for (const opt of options) {
        opt.addEventListener("click", () => {
            const id = opt.dataset.accent ?? defaultId;
            clearCustom();
            if (id === defaultId) delete root.dataset.accent;
            else root.dataset.accent = id;
            save(ACCENT_KEY, id === defaultId ? null : id);
            sync();
        });
    }

    for (const opt of fontOptions) {
        opt.addEventListener("click", () => {
            const id = opt.dataset.font ?? defaultFont;
            if (id === defaultFont) delete root.dataset.font;
            else root.dataset.font = id;
            save(FONT_KEY, id === defaultFont ? null : id);
            sync();
        });
    }

    // "input" fires continuously while dragging in the native picker.
    colorInput?.addEventListener("input", () => {
        const hex = normaliseHex(colorInput.value);
        if (!hex) return;
        if (hexInput) {
            hexInput.value = hex;
            hexInput.removeAttribute("aria-invalid");
        }
        applyCustom(hex);
    });

    hexInput?.addEventListener("input", () => {
        const raw = hexInput.value.trim();
        const hex = normaliseHex(raw);
        // Only flag it once it is long enough to be a finished code.
        if (!hex) {
            if (raw.replace("#", "").length >= 6) hexInput.setAttribute("aria-invalid", "true");
            else hexInput.removeAttribute("aria-invalid");
            return;
        }
        hexInput.removeAttribute("aria-invalid");
        if (colorInput) colorInput.value = hex;
        applyCustom(hex);
    });

    picker.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && root.dataset.accentPicker === "open") {
            setOpen(false);
            toggle?.focus();
        }
    });

    sync();
});
