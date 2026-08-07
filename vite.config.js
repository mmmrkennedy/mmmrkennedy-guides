import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Custom plugin to serve the games directory during development
function serveGamesDirectory() {
    return {
        name: "serve-games-directory",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                // Check if request is for a file in /games/
                if (req.url && (req.url.startsWith("/games/") || req.url.startsWith("/css/"))) {
                    const urlPath = req.url.split("?")[0];
                    const filePath = path.join(__dirname, "src", urlPath);
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                        // Serve the file
                        const ext = path.extname(filePath);
                        const contentTypes = {
                            ".webp": "image/webp",
                            ".png": "image/png",
                            ".jpg": "image/jpeg",
                            ".jpeg": "image/jpeg",
                            ".svg": "image/svg+xml",
                            ".gif": "image/gif",
                            ".css": "text/css",
                        };
                        res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
                        fs.createReadStream(filePath).pipe(res);
                        return;
                    }
                }
                next();
            });
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [preact(), serveGamesDirectory()],

    // Serve from react-solvers directory for dev server
    root: path.resolve(__dirname, "./src/react-solvers"),

    // Set the base URL for assets
    base: "/",

    // Explicitly set publicDir to false since we're handling static files with our custom middleware
    publicDir: false,

    // Tell Vite where the index.html is for dev server
    server: {
        open: true, // Just open the root index.html
    },

    // Exclude styles.css from being processed/bundled
    css: {
        preprocessorOptions: {
            // This won't work for plain CSS, see build.rollupOptions instead
        },
    },

    // Build configuration
    build: {
        // Output directory for built files (builds from src/react-solvers to dist/react-solvers)
        outDir: path.resolve(__dirname, "./dist/react-solvers"),

        // Clear the output directory before building
        emptyOutDir: true,

        sourcemap: false,

        // Generate manifest for dynamic bundle resolution
        manifest: true,

        rollupOptions: {
            input: path.resolve(__dirname, "src/react-solvers/index.html"),
            output: {
                // ES, not IIFE, because IIFE cannot be code-split: Rollup has to
                // flatten everything reachable from the entry into one file, which
                // meant all 19 solvers shipped to every guide (28.9kB brotli, ~74%
                // of it unexecuted on any given page). With `es`, each solver's
                // dynamic import() in src/main.tsx becomes its own chunk and a page
                // downloads only the one it mounts.
                //
                // The `window.ZombiesSolvers` global that guide pages call is NOT
                // affected. It never came from Rollup's `name` option (that only
                // applies to iife/umd) — src/main.tsx assigns it explicitly, and an
                // ES module can do that just as well. `name` is dropped here because
                // it is inert for this format, not because the global went away.
                //
                // Safe for the injected <script type="module"> tag in
                // eleventy.config.cjs, which is already a module tag.
                format: "es",
            },
            // Exclude styles.css from being bundled
            external: ["/css/styles.css", "css/styles.css"],
        },
    },
});
