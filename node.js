const http = require("http");

const { HOST, PORT, PUBLIC_DIR, COMPRESS_ENABLED, COMPRESS_CONCURRENCY, BASE_HEADERS } = require("./lib/constants");
const { sanitizePath, buildStdHeaders } = require("./lib/utils");
const { startStatCachePruner } = require("./lib/fsCache");
const { handleRoutes } = require("./lib/routes");
const { serveStaticFile } = require("./lib/staticFile");
const { loadExtensions, runExtensions } = require("./lib/extensions");
const { ensureMasterConfig, ensureThemeConfig } = require("./lib/siteConfig");
const { ensureFavicon } = require("./lib/favicon");
const { ensureAboutMe } = require("./lib/aboutMe");
const { startBackupScheduler, startTerminalCommands } = require("./lib/backup");
const { startAdminServer } = require("./lib/adminServer");
const { startUpdateChecker } = require("./lib/updateChecker");

ensureMasterConfig();
ensureThemeConfig();

async function boot() {
    await ensureFavicon();

    ensureAboutMe();

    startStatCachePruner();

    loadExtensions();

    startBackupScheduler();

    startTerminalCommands();

    startUpdateChecker();

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

        const stdHeaders = buildStdHeaders(safePath);

        if (handleRoutes(req, res, safePath, stdHeaders)) return;

        if (runExtensions(req, res, safePath, stdHeaders)) return;

        serveStaticFile(req, res, safePath, stdHeaders);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout   = 70000;

    server.maxRequestsPerSocket = 0;
    server.requestTimeout       = 0;

    server.listen(PORT, HOST, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Serving: ${PUBLIC_DIR}`);
        console.log(`Compression: ${COMPRESS_ENABLED ? `enabled (concurrency ${COMPRESS_CONCURRENCY})` : "disabled"}`);
    });
}

boot();
