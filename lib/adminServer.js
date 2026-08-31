const fs = require("fs");
const path = require("path");
const http = require("http");
const { ADMIN_DIR, ADMIN_HOST, ADMIN_PORT, MIME_TYPES } = require("./constants");
const { sanitizePath, buildStdHeaders } = require("./utils");
const { handleAdminRoutes } = require("./adminRoutes");
const { serveStaticFile } = require("./staticFile");

const DEBUG_ROUTES = process.env.ADMIN_DEBUG_ROUTES === "1";

const SPA_SHELLS = [
    {
        prefix: "/library-explorer",
        indexPath: path.join(ADMIN_DIR, "library-explorer", "index.html"),
    },
];

function logAd(...args) {
    console.log("[admin]", ...args);
}

function getMime(fsPath) {
    const ext = path.extname(fsPath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function isRealAdminFile(safePath) {
    const fsPath = path.join(ADMIN_DIR, safePath);
    if (!fsPath.startsWith(ADMIN_DIR)) return false;
    try {
        return fs.statSync(fsPath).isFile();
    } catch {
        return false;
    }
}

function rawPathname(reqUrl) {
    try {
        return new URL(reqUrl || "/", "http://internal").pathname;
    } catch {
        return "/";
    }
}

function findSpaShell(pathname) {
    for (const shell of SPA_SHELLS) {
        if (pathname === shell.prefix || pathname.startsWith(`${shell.prefix}/`)) {
            return shell;
        }
    }
    return null;
}

function serveSpaShell(req, res, shell) {
    let html;
    try {
        html = fs.readFileSync(shell.indexPath, "utf-8");
    } catch (e) {
        logAd(`SPA shell missing/unreadable on disk: ${shell.indexPath} (${e.message})`);
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
    }

    const body = Buffer.from(html, "utf-8");
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") { res.end(); return; }
    res.end(body);
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
        if (DEBUG_ROUTES) logAd(`static: "${safePath}" not under ADMIN/ — falling back to PUBLIC_DIR`);
        const stdHeaders = buildStdHeaders(safePath);
        serveStaticFile(req, res, safePath, stdHeaders);
        return;
    }

    if (DEBUG_ROUTES) logAd(`static: "${safePath}" -> ${fsPath}`);

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

    for (const shell of SPA_SHELLS) {
        if (!fs.existsSync(shell.indexPath)) {
            logAd(`WARNING: SPA route "${shell.prefix}" points at a missing file: ${shell.indexPath}`);
        }
    }

    const server = http.createServer(async (req, res) => {
        if (!["GET", "HEAD", "PUT", "POST"].includes(req.method || "")) {
            res.writeHead(405, { "Content-Type": "text/plain", "Allow": "GET, HEAD, PUT, POST" });
            res.end("Method Not Allowed");
            return;
        }

        const rawPath  = rawPathname(req.url);
        const safePath = sanitizePath(req.url || "/");

        if (DEBUG_ROUTES) {
            logAd(`${req.method} raw="${rawPath}" safe="${safePath}"${rawPath !== safePath ? "  << SANITIZER CHANGED THE PATH" : ""}`);
        }

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
            const shell = findSpaShell(rawPath);

            if (shell) {
                if (isRealAdminFile(rawPath)) {
                    if (DEBUG_ROUTES) logAd(`spa: "${rawPath}" is a real asset — serving directly`);
                    serveAdminStatic(req, res, rawPath);
                } else {
                    if (DEBUG_ROUTES) logAd(`spa: "${rawPath}" -> shell ${shell.indexPath}`);
                    serveSpaShell(req, res, shell);
                }
                return;
            }

            serveAdminStatic(req, res, safePath);
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
        }
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout   = 70000;
    server.maxRequestsPerSocket = 0;
    server.requestTimeout       = 0;

    server.listen(ADMIN_PORT, ADMIN_HOST, () => {
        console.log(`Admin server running at http://localhost:${ADMIN_PORT}`);
        console.log(`Serving admin: ${ADMIN_DIR}`);
    });

    return server;
}

module.exports = { startAdminServer };
