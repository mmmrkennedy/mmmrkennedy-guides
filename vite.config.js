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

// Under `dev:watch`, tells the Eleventy dev server a new browser build landed.
// Eleventy can't watch the manifest itself: it never watches anything under its
// own output folder (dist/). So the build drops a stamp in .solver-ssr/, which it
// does watch (see eleventy.config.cjs), and solvers.cjs then re-reads the
// manifest for the new chunk hashes. Harmless in a one-shot build.
function stampSolverBuild() {
    return {
        name: "stamp-solver-build",
        apply: "build",
        writeBundle() {
            const dir = path.resolve(__dirname, ".solver-ssr");
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, "client-build-stamp"), String(Date.now()));
        },
    };
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [preact(), serveGamesDirectory(), stampSolverBuild()],

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
                // Safe for the injected <script type="module"> tag in
                // build_scripts/eleventy/solvers.cjs, which is already a module tag.
                format: "es",
            },
            // Exclude styles.css from being bundled
            external: ["/css/styles.css", "css/styles.css"],
        },
    },
});
