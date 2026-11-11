import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function serveGamesDirectory() {
    return {
        name: "serve-games-directory",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (req.url && (req.url.startsWith("/games/") || req.url.startsWith("/css/"))) {
                    const urlPath = req.url.split("?")[0];
                    const filePath = path.join(__dirname, "src", urlPath);
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
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

// Eleventy never watches its own output (dist/), so the manifest can't trigger a
// reload. This stamp in .solver-ssr/ is watched (eleventy.config.cjs), and
// solvers.cjs then re-reads the manifest.
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

export default defineConfig({
    plugins: [preact(), serveGamesDirectory(), stampSolverBuild()],

    root: path.resolve(__dirname, "./src/react-solvers"),

    base: "/",

    // Static files are served by serveGamesDirectory.
    publicDir: false,

    server: {
        open: true,
    },

    css: {
        preprocessorOptions: {
        },
    },

    build: {
        outDir: path.resolve(__dirname, "./dist/react-solvers"),

        emptyOutDir: true,

        sourcemap: false,

        manifest: true,

        rollupOptions: {
            input: path.resolve(__dirname, "src/react-solvers/index.html"),
            output: {
                // Not IIFE: it can't code-split, so every solver would ship to every
                // guide. solvers.cjs already injects a <script type="module"> tag.
                format: "es",
            },
            external: ["/css/styles.css", "css/styles.css"],
        },
    },
});
