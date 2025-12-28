/**
 * Static file server with subpage routing and explicit 404.
 * Root: serves from ./public
 * Subpages: /:slug -> ./public/sub-page/:slug/index.html (if exists)
 * Missing routes: returns a plain white 404 page.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 2138;
const PUBLIC_DIR = path.join(__dirname, "public");

// Minimal MIME type map
const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".wasm": "application/wasm",
};

function sanitizeUrl(urlPath) {
    const cleanPath = urlPath.split("?")[0].split("#")[0];
    const decoded = decodeURIComponent(cleanPath);
    const normalized = path.posix.normalize(decoded);
    if (normalized.includes("..")) return "/";
    return normalized;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function sendResponse(res, status, headers, bodyOrStream) {
    res.writeHead(status, headers);
    if (bodyOrStream instanceof fs.ReadStream) {
        bodyOrStream.pipe(res);
    } else if (Buffer.isBuffer(bodyOrStream) || typeof bodyOrStream === "string") {
        res.end(bodyOrStream);
    } else {
        res.end();
    }
}

function fileExists(filePath) {
    try {
        const st = fs.statSync(filePath);
        return st.isFile();
    } catch {
        return false;
    }
}

function notFound(res, baseHeaders) {
    const html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>404</title></head><body style=\"margin:0;background:#fff;color:#000;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial\"><div style=\"display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px;\">404 page not present</div></body></html>";
    return sendResponse(res, 404, { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" }, html);
}

const server = http.createServer((req, res) => {
    const baseHeaders = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "X-XSS-Protection": "0",
        "Referrer-Policy": "no-referrer-when-downgrade",
        // For LAN dev, you can omit COOP/CORP to avoid warnings:
        // "Cross-Origin-Opener-Policy": "same-origin",
        // "Cross-Origin-Resource-Policy": "same-site",
        "Cache-Control": "public, max-age=300",
    };

    if (!["GET", "HEAD"].includes(req.method || "")) {
        return sendResponse(res, 405, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" }, "Method Not Allowed");
    }

    const safePath = sanitizeUrl(req.url || "/");
    const ext = path.extname(safePath);

    // 1) Try direct static file in PUBLIC_DIR
    let fsPath = path.join(PUBLIC_DIR, safePath);
    try {
        const st = fs.statSync(fsPath);
        if (st.isDirectory()) {
            const indexPath = path.join(fsPath, "index.html");
            if (fileExists(indexPath)) {
                const headers = { ...baseHeaders, "Content-Type": getMimeType(indexPath), "Last-Modified": st.mtime.toUTCString() };
                return sendResponse(res, 200, headers, req.method === "HEAD" ? "" : fs.createReadStream(indexPath));
            }
            // If directory without index.html, treat as missing
        } else if (st.isFile()) {
            const headers = { ...baseHeaders, "Content-Type": getMimeType(fsPath), "Last-Modified": st.mtime.toUTCString() };
            return sendResponse(res, 200, headers, req.method === "HEAD" ? "" : fs.createReadStream(fsPath));
        }
    } catch {
        // proceed to subpage / fallback
    }

    // 2) If request looks like a static asset (.json, .css, .js, images...) and not found → 404
    if (ext) {
        return notFound(res, baseHeaders);
    }

    // 3) Subpage routing: /slug -> /sub-page/slug/index.html
    const parts = safePath.replace(/^\/+/, "").split("/");
    const slug = parts[0] || "";
    if (slug) {
        const subIndex = path.join(PUBLIC_DIR, "sub-page", slug, "index.html");
        if (fileExists(subIndex)) {
            const st = fs.statSync(subIndex);
            const headers = { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "Last-Modified": st.mtime.toUTCString() };
            return sendResponse(res, 200, headers, req.method === "HEAD" ? "" : fs.createReadStream(subIndex));
        }
        // Missing subpage -> 404
        return notFound(res, baseHeaders);
    }

    // 4) Root route: serve public/index.html or 404 if missing
    const rootIndex = path.join(PUBLIC_DIR, "index.html");
    if (fileExists(rootIndex)) {
        const st = fs.statSync(rootIndex);
        const headers = { ...baseHeaders, "Content-Type": "text/html; charset=utf-8", "Last-Modified": st.mtime.toUTCString() };
        return sendResponse(res, 200, headers, req.method === "HEAD" ? "" : fs.createReadStream(rootIndex));
    }

    return notFound(res, baseHeaders);
});

server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Static server running at ${url}`);
    console.log(`Serving directory: ${PUBLIC_DIR}`);
});
