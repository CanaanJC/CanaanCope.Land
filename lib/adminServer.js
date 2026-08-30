const fs = require("fs");
const path = require("path");
const http = require("http");
const { ADMIN_DIR, ADMIN_HOST, ADMIN_PORT, MIME_TYPES } = require("./constants");
const { sanitizePath, buildStdHeaders } = require("./utils");
const { handleAdminRoutes } = require("./adminRoutes");
const { serveStaticFile } = require("./staticFile");

// Set ADMIN_DEBUG_ROUTES=1 in the environment to log every incoming request's
// raw URL and its post-sanitizePath() form, plus which branch served it.
// This is the fastest way to catch a sanitizePath() that's collapsing a
// path (e.g. "/library-explorer" -> "/"), which presents as "the admin
// page loads instead of the page I asked for" with no redirect involved.
const DEBUG_ROUTES = process.env.ADMIN_DEBUG_ROUTES === "1";

// ── SPA shells ───────────────────────────────────────────────────────────
//
// The Library Explorer is a standalone SPA-style page living at
// ADMIN/library-explorer/. Deep links like
//   /library-explorer/template/K1SE_MC_Mod
// don't correspond to real files on disk — they're client-side routes,
// pushed via history.pushState and restored on load by
// library-explorer.js reading window.location.pathname itself. So any
// request under /library-explorer/ that ISN'T an actual static asset (its
// own index.html, js/*.js, css/*.css, *.md, library.json) falls back to
// serving that shell's index.html instead of 404ing — see
// isRealAdminFile() / findSpaShell() / serveSpaShell() below.
//
// This is a LIST rather than a single hardcoded path so renaming or adding
// another SPA page never silently breaks reloads again: just add its route
// prefix + index.html here.
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

// True if `safePath`, resolved under ADMIN_DIR, is a real, existing FILE
// (not a directory, not missing).
function isRealAdminFile(safePath) {
    const fsPath = path.join(ADMIN_DIR, safePath);
    if (!fsPath.startsWith(ADMIN_DIR)) return false;
    try {
        return fs.statSync(fsPath).isFile();
    } catch {
        return false;
    }
}

// ── Raw-URL SPA matching ─────────────────────────────────────────────────
//
// Deliberately matched against the RAW request URL's pathname, NOT the
// sanitized path. sanitizePath() is a security filter shared with the
// public server, and if it ever normalizes/collapses a path (returning
// "/" for something it doesn't like), an SPA route would silently end up
// serving ADMIN/index.html — indistinguishable, from the browser's side,
// from "the Library Explorer redirects me to the admin page". Matching the
// raw pathname here removes that entire failure mode; the shell's HTML is
// a fixed file read from disk, so no user-controlled path ever reaches the
// filesystem through this branch.
function rawPathname(reqUrl) {
    try {
        return new URL(reqUrl || "/", "http://internal").pathname;
    } catch {
        return "/";
    }
}

// Returns the SPA_SHELLS entry whose prefix owns `pathname`, or null.
// Matches the bare prefix ("/library-explorer"), the slashed form
// ("/library-explorer/") and anything beneath it.
function findSpaShell(pathname) {
    for (const shell of SPA_SHELLS) {
        if (pathname === shell.prefix || pathname.startsWith(`${shell.prefix}/`)) {
            return shell;
        }
    }
    return null;
}

// Serves an SPA's index.html verbatim, regardless of the actual request
// path — the client-side router in that page's own JS reads
// window.location.pathname itself to restore state on load.
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
        // ── Cross-port fallback ────────────────────────────────────────────
        // Not a real file under ADMIN/. Rather than 404ing outright, fall
        // back to serving it as a normal PUBLIC_DIR static file (same logic
        // the main public server uses — compression variants, range
        // requests, caching, the custom 404 page, etc). This is what makes
        // the Library Explorer's media manager / live preview work: those
        // pages are served from the ADMIN port, but the actual image/video/
        // audio files they reference live under public/.
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

    // Warn loudly at boot if a configured SPA shell doesn't exist, rather
    // than only discovering it as a mystery 404 on someone's page reload.
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
            // SPA prefixes are matched on the RAW pathname (see rawPathname
            // above) so a path-collapsing sanitizer can never divert a
            // Library Explorer URL into ADMIN/index.html.
            const shell = findSpaShell(rawPath);

            if (shell) {
                // A real asset under the prefix (js/css/md/json/index.html)
                // is served normally; everything else is a client-side
                // route and gets the shell.
                //
                // isRealAdminFile() is checked against the RAW path too —
                // if the sanitizer mangled safePath, using it here would
                // make genuine assets look nonexistent and get replaced by
                // HTML (which is what produces "expected a JavaScript
                // module but the server responded with text/html" errors).
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
