const fs = require("fs");
const path = require("path");
const http = require("http");
const { ADMIN_DIR, ADMIN_HOST, ADMIN_PORT, MIME_TYPES } = require("./constants");
const { sanitizePath, buildStdHeaders } = require("./utils");
const { handleAdminRoutes } = require("./adminRoutes");
const { serveStaticFile } = require("./staticFile");

// The Blog Editor is a small standalone SPA-style page living at
// ADMIN/blog-editor/. Deep links like /blog-editor/template/blog don't
// correspond to real files on disk — they're client-side routes handled
// entirely by blog-editor.js reading window.location.pathname. So any
// request under /blog-editor/ that ISN'T an actual static asset (its own
// index.html, blog-editor.js, blog-editor.css) falls back to serving
// index.html instead of 404ing — see isRealAdminFile()/serveBlogEditorShell()
// below.
const BLOG_EDITOR_INDEX = path.join(ADMIN_DIR, "blog-editor", "index.html");

function logAd(...args) {
    console.log("[admin]", ...args);
}

function getMime(fsPath) {
    const ext = path.extname(fsPath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

// True if `safePath`, resolved under ADMIN_DIR, is a real, existing FILE
// (not a directory, not missing). Used to decide whether a /blog-editor/*
// request should be served as-is (a real asset) or fall back to the SPA
// shell (a client-side route like /blog-editor/template/blog).
function isRealAdminFile(safePath) {
    const fsPath = path.join(ADMIN_DIR, safePath);
    if (!fsPath.startsWith(ADMIN_DIR)) return false;
    try {
        return fs.statSync(fsPath).isFile();
    } catch {
        return false;
    }
}

// Serves ADMIN/blog-editor/index.html verbatim, regardless of the actual
// request path — the client-side router in blog-editor.js reads
// window.location.pathname itself to restore state on load.
function serveBlogEditorShell(req, res) {
    let html;
    try {
        html = fs.readFileSync(BLOG_EDITOR_INDEX, "utf-8");
    } catch {
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
        // ── Cross-port fallback ────────────────────────────────────────────
        // Not a real file under ADMIN/. Rather than 404ing outright, fall
        // back to serving it as a normal PUBLIC_DIR static file (same logic
        // the main public server uses — compression variants, range
        // requests, caching, the custom 404 page, etc). This is what makes
        // the Blog Editor's media manager / live preview work correctly:
        // those pages are served from the ADMIN port, but the actual image/
        // video/audio files they reference (blog media, thumbnails, logo,
        // etc.) live under public/ and are otherwise only reachable on the
        // main public port. Without this, every such request 404s because
        // the admin server previously had no route to PUBLIC_DIR at all.
        const stdHeaders = buildStdHeaders(safePath);
        serveStaticFile(req, res, safePath, stdHeaders);
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
            const isBlogEditorPath = safePath === "/blog-editor" || safePath.startsWith("/blog-editor/");
            if (isBlogEditorPath && !isRealAdminFile(safePath)) {
                serveBlogEditorShell(req, res);
            } else {
                serveAdminStatic(req, res, safePath);
            }
        } else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("404 Not Found");
        }
    });

    // Bump limits — same rationale as the main public server (server.js):
    // media-heavy admin requests (blog media manager grids, live preview
    // iframe, etc.) shouldn't be throttled by short defaults.
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
