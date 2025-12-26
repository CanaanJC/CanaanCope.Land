/**
 * Simple static file server using Node's http and fs modules.
 * Serves files from the ./public directory (e.g., ./public/index.html).
 * MIME types are inferred by extension. Includes basic 404 and security headers.
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
    // Remove query/hash, normalize, prevent directory traversal
    const cleanPath = urlPath.split("?")[0].split("#")[0];
    const decoded = decodeURIComponent(cleanPath);
    const normalized = path.posix.normalize(decoded);
    if (normalized.includes("..")) return "/";
    return normalized;
}

function resolveFile(filePath) {
    // If path is directory, serve index.html
    try {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            const indexPath = path.join(filePath, "index.html");
            if (fs.existsSync(indexPath)) return indexPath;
        }
    } catch {
        // ignore
    }
    return filePath;
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function sendResponse(res, status, headers, streamOrBody) {
    res.writeHead(status, headers);
    if (streamOrBody instanceof fs.ReadStream) {
        streamOrBody.pipe(res);
    } else if (Buffer.isBuffer(streamOrBody) || typeof streamOrBody === "string") {
        res.end(streamOrBody);
    } else {
        res.end();
    }
}

const server = http.createServer((req, res) => {
    // Security and caching headers
    const baseHeaders = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "X-XSS-Protection": "0",
        "Referrer-Policy": "no-referrer-when-downgrade",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
        "Cache-Control": "public, max-age=300",
    };

    // Only allow GET/HEAD
    if (!["GET", "HEAD"].includes(req.method || "")) {
        return sendResponse(res, 405, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8", "Allow": "GET, HEAD" }, "Method Not Allowed");
    }

    const safePath = sanitizeUrl(req.url || "/");
    let filePath = path.join(PUBLIC_DIR, safePath);
    filePath = resolveFile(filePath);

    // Ensure file is within PUBLIC_DIR
    const relative = path.relative(PUBLIC_DIR, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return sendResponse(res, 403, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" }, "Forbidden");
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            // Fallback to index.html for SPA-style routing if it exists
            const spaIndex = path.join(PUBLIC_DIR, "index.html");
            if (fs.existsSync(spaIndex)) {
                const mime = getMimeType(spaIndex);
                const stream = fs.createReadStream(spaIndex);
                return sendResponse(res, 200, { ...baseHeaders, "Content-Type": mime }, req.method === "HEAD" ? "" : stream);
            }
            return sendResponse(res, 404, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" }, "Not Found");
        }

        // Conditional GET handling
        const lastModified = stats.mtime.toUTCString();
        if (req.headers["if-modified-since"] && new Date(req.headers["if-modified-since"]) >= stats.mtime) {
            return sendResponse(res, 304, { ...baseHeaders, "Last-Modified": lastModified }, "");
        }

        const mime = getMimeType(filePath);
        const headers = { ...baseHeaders, "Content-Type": mime, "Last-Modified": lastModified };

        if (req.method === "HEAD") {
            return sendResponse(res, 200, headers, "");
        }

        const stream = fs.createReadStream(filePath);
        stream.on("error", () => {
            sendResponse(res, 500, { ...baseHeaders, "Content-Type": "text/plain; charset=utf-8" }, "Internal Server Error");
        });
        sendResponse(res, 200, headers, stream);
    });
});

server.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Static server running at ${url}`);
    console.log(`Serving directory: ${PUBLIC_DIR}`);
});
