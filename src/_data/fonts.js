/**
 * Font options for the picker (base.njk, src/ts/ui/accent-picker.ts).
 *
 * `id` is the value written to <html data-font>, and each one except the default
 * needs an @font-face plus a :root[data-font="id"] block in reset.css.
 * The first entry is the default: it has no data-font and loads no font file.
 */
export default [
    { id: "default", name: "Default" },
    { id: "lexend", name: "Lexend" },
];
