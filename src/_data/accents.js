/**
 * Main-colour options for the accent picker (base.njk, src/ts/ui/accent-picker.ts).
 *
 * `id` is the value written to <html data-accent>, and each one except the
 * default needs a matching :root[data-accent="id"] block in tokens.css.
 * `swatch` is the dot shown in the picker (any CSS background), and should match
 * that block's tier-1.
 * The first entry is the default: it has no data-accent and uses :root as-is.
 */
export default [
    { id: "crimson", name: "Crimson", swatch: "#ee7474" },
    { id: "gold", name: "Gold", swatch: "#c9a961" },
    { id: "ember", name: "Ember", swatch: "#e8935a" },
    { id: "ice", name: "Ice", swatch: "#8fd4e0" },
    { id: "rose", name: "Rose", swatch: "#e590a8" },
    { id: "lime", name: "Lime", swatch: "#b5d94a" },
    { id: "bone", name: "Bone", swatch: "#ddd2b8" },
    { id: "magenta", name: "Magenta", swatch: "#e07ad0" },
    { id: "amber", name: "Amber", swatch: "#f0c040" },
    { id: "steel", name: "Steel", swatch: "#b4c0d0" },
    {
        id: "rainbow",
        name: "Rainbow",
        swatch: "conic-gradient(oklch(0.72 0.15 25), oklch(0.72 0.15 85), oklch(0.72 0.15 145), oklch(0.72 0.15 205), oklch(0.72 0.15 265), oklch(0.72 0.15 325), oklch(0.72 0.15 25))",
    },
];
