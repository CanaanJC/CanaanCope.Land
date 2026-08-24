const fs = require("fs");
const path = require("path");
const http = require("http");
const { ADMIN_DIR, ADMIN_HOST, ADMIN_PORT, MIME_TYPES } = require("./constants");
const { sanitizePath } = require("./utils");
const { handleAdminRoutes } = require("./adminRoutes");

function logAd(...args) {
    console.log("[admin]", ...args);
}

function getMime(fsPath) {
    const ext = path.extname(fsPath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function serveAdminStatic(req, res, safePath) {
    let fsPath = path.join(ADMIN_DIR, safePath);

    if (!fsPath.startsWith(ADMIN_DIR)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
    }

    let stat;
    try { stat = fs.statSync(fsPath); } catch { stat = null; }

    if (stat && stat.isDirectory()) {
        fsPath = path.join(fsPath, "index.html");
        try { stat = fs.statSync(fsPath); } catch { stat = null; }
    }

    if (!stat || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
    }

    res.writeHead(200, {
        "Content-Type": getMime(fsPath),
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") { res.end(); return; }

    fs.createReadStream(fsPath).pipe(res);
}

function startAdminServer() {
    if (!fs.existsSync(ADMIN_DIR)) {
        logAd("no ADMIN/ directory found — admin panel not started");
        return null;
    }

    const server = http.createServer(async (req, res) => {
        if (!["GET", "HEAD", "PUT", "POST"].includes(req.method || "")) {
            res.writeHead(405, { "Content-Type": "text/plain", "Allow": "GET, HEAD, PUT, POST" });
            res.end("Method Not Allowed");
            return;
        }

        const safePath = sanitizePath(req.url || "/");

        try {
            if (await handleAdminRoutes(req, res, safePath)) return;
        } catch (e) {
            logAd(`route error: ${e.message}`);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        if (req.method === "GET" || req.method === "HEAD") {
            serveAdminStatic(req, res, safePath);
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
        }
    });

    server.listen(ADMIN_PORT, ADMIN_HOST, () => {
        console.log(`Admin server running at http://localhost:${ADMIN_PORT}`);
        console.log(`Serving admin: ${ADMIN_DIR}`);
    });

    return server;
}

module.exports = { startAdminServer };
