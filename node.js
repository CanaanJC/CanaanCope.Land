const http = require("http");

const { HOST, PORT, PUBLIC_DIR, COMPRESS_ENABLED, COMPRESS_CONCURRENCY, BASE_HEADERS } = require("./lib/constants");
const { sanitizePath, buildStdHeaders } = require("./lib/utils");
const { startStatCachePruner } = require("./lib/fsCache");
const { handleRoutes } = require("./lib/routes");
const { serveStaticFile } = require("./lib/staticFile");
const { loadExtensions, runExtensions } = require("./lib/extensions");
const { ensureMasterConfig } = require("./lib/siteConfig");
const { ensureFavicon } = require("./lib/favicon");
const { startBackupScheduler, startTerminalCommands } = require("./lib/backup");
const { startAdminServer } = require("./lib/adminServer");

// Ensure config/master.json exists and is fully populated before anything
// else boots — routes/embed/frontend/backup/admin all assume a complete config.
ensureMasterConfig();

async function boot() {
    // Generate media/favicon.png from media/logo.png if it doesn't exist yet.
    // No-op (and never overwrites) once a favicon.png is present.
    await ensureFavicon();

    // Keep the tiny stat cache bounded / fresh.
    startStatCachePruner();

    // Dynamically discover and initialize anything dropped into ./extensions.
    // Nothing is hardcoded here — an empty or missing folder is fine.
    loadExtensions();

    // Full-server backup scheduler (daily/weekly/monthly/yearly, per
    // config/master.json's backup section). No-op if backup.enabled is false.
    startBackupScheduler();

    // Type "backup" + Enter directly into this terminal to trigger one on
    // demand, regardless of schedule/enabled state — for testing.
    startTerminalCommands();

    // Second HTTP server (separate port, separate ./ADMIN root) for the
    // admin panel — started here so ONE boot command (`node node.js`)
    // launches both. No-op with a log message if ./ADMIN doesn't exist
    // (e.g. older archived backups made before Admin existed).
    startAdminServer();

    const server = http.createServer((req, res) => {
        if (!["GET", "HEAD"].includes(req.method || "")) {
            res.writeHead(405, {
                ...BASE_HEADERS,
                "Content-Type": "text/plain",
                "Allow": "GET, HEAD",
                "Cache-Control": "no-store",
            });
            res.end("Method Not Allowed");
            return;
        }

        const safePath = sanitizePath(req.url || "/");

        // Standard header set for this request: every non-root path receives
        // X-Robots-Tag: noindex, follow so only the root domain stays indexed.
        const stdHeaders = buildStdHeaders(safePath);

        // Manifest / media-listing / embed-page routes.
        if (handleRoutes(req, res, safePath, stdHeaders)) return;

        // Extension-provided routes/handlers. Runs after core routes so
        // extensions can't accidentally shadow built-in endpoints, but before
        // static file serving so they can add server-side behavior anywhere.
        if (runExtensions(req, res, safePath, stdHeaders)) return;

        // Fallback: static file serving (with directory→index.html resolution,
        // compression-variant substitution, conditional requests, range requests).
        serveStaticFile(req, res, safePath, stdHeaders);
    });

    // Encourage longer-lived sockets from upstream (Caddy) so it doesn't pay
    // TCP/TLS setup cost repeatedly for each new request batch.
    server.keepAliveTimeout = 65000;  // ms — must be > Caddy's keep-alive timeout
    server.headersTimeout   = 70000;

    // Bump max sockets / listeners — Node default of 10 event listeners on a
    // single emitter can throttle high-concurrency image loads.
    server.maxRequestsPerSocket = 0; // unlimited
    server.requestTimeout       = 0; // disable per-request timeout (large media)

    server.listen(PORT, HOST, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Serving: ${PUBLIC_DIR}`);
        console.log(`Compression: ${COMPRESS_ENABLED ? `enabled (concurrency ${COMPRESS_CONCURRENCY})` : "disabled"}`);
    });
}

boot();
