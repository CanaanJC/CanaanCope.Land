const fs = require("fs");
const path = require("path");

const { PUBLIC_DIR, COMPRESS_ENABLED, FALLBACK_CACHE } = require("./constants");
const {
    getMimeType,
    getCacheControl,
    makeETag,
    pickHighWaterMark,
    parseRange,
    relPub,
    injectTwemoji,
} = require("./utils");
const { cachedStat } = require("./fsCache");
const { getLibraries } = require("./siteConfig");
const {
    isInsideCmpsd,
    getVariantInfo,
    scheduleVariantBuild,
    inProgress,
    logC,
} = require("./compression");

const NOT_FOUND_HTML_PATH = path.join(PUBLIC_DIR, "404", "404.html");

// ── Transparent "public/libraries/" relocation ────────────────────────────
//
// Libraries (config/libraries.json) are physically stored under
// public/libraries/<path> on disk, but every URL/link/manifest/config still
// refers to them by their bare <path> (e.g. "/template/...", not
// "/libraries/template/..."). This resolves a sanitized request path to its
// real on-disk location: if the first path segment matches a configured
// library's `path`, the file is looked up under public/libraries/ instead
// of directly under public/ — completely transparent to every client-side
// fetch, link, and manifest entry, which never need to know "libraries/"
// exists at all. Anything that isn't a library path (aboutme, 404, css, js,
// media, archive, etc.) resolves exactly as before.
function resolveFsPath(safePath) {
    const firstSegment = safePath.split("/").filter(Boolean)[0];
    if (firstSegment) {
        const isLibraryPath = getLibraries().some(lib => lib.path === firstSegment);
        if (isLibraryPath) {
            return path.join(PUBLIC_DIR, "libraries", safePath);
        }
    }
    return path.join(PUBLIC_DIR, safePath);
}

// Serves the custom 404 page (public/404/404.html), with the Twemoji
// script tag injected server-side. Not a redirect — the browser's address
// bar keeps whatever URL was actually requested; only the response body/
// status change. Falls back to plain text if the 404 page itself is
// somehow missing, so a broken/missing 404.html can never itself produce
// an unhandled error.
function send404Page(req, res, stdHeaders) {
    let html;
    try {
        html = fs.readFileSync(NOT_FOUND_HTML_PATH, "utf-8");
        html = injectTwemoji(html);
    } catch {
        html = "404 Not Found";
    }
    const body = Buffer.from(html, "utf-8");

    res.writeHead(404, {
        ...stdHeaders,
        "Content-Type":   "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control":  "no-store",
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }
    res.end(body);
}

// Serves a static file (with directory→index.html resolution, transparent
// compressed-variant substitution, conditional requests, and range requests).
// HTML files are handled as a special case: read fully into memory, have the
// Twemoji <script> tag injected into <head> server-side (see
// lib/utils.js: injectTwemoji), then served as a single buffer — no .html
// file on disk needs to carry that tag itself. Every other file type keeps
// the original streaming/range/conditional-request behavior untouched.
// Returns true if the request was handled (always true unless the caller
// should not have invoked this — kept for symmetry with other handlers).
function serveStaticFile(req, res, safePath, stdHeaders) {
    let fsPath = resolveFsPath(safePath);

    // Guard against path traversal escaping PUBLIC_DIR
    if (!fsPath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { ...stdHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("403 Forbidden");
        return;
    }

    const initialStat = cachedStat(fsPath);
    if (!initialStat) {
        send404Page(req, res, stdHeaders);
        return;
    }

    let finalStat = initialStat;

    if (initialStat.isDirectory()) {
        const indexPath = path.join(fsPath, "index.html");
        const idxStat   = cachedStat(indexPath);
        if (idxStat && idxStat.isFile()) {
            fsPath    = indexPath;
            finalStat = idxStat;
        } else {
            send404Page(req, res, stdHeaders);
            return;
        }
    } else if (!initialStat.isFile()) {
        send404Page(req, res, stdHeaders);
        return;
    }

    const ext = path.extname(fsPath).toLowerCase();

    // ── HTML — special-cased: read fully, inject Twemoji script tag,
    // serve as a single in-memory buffer. Range requests don't apply to
    // HTML pages, so this bypasses that whole path entirely; conditional
    // requests (If-None-Match / If-Modified-Since) still work, just
    // computed against the ORIGINAL file's stat (the injection is
    // deterministic and always identical for a given source file, so the
    // original file's mtime/size remains a perfectly valid cache key).
    if (ext === ".html" || ext === ".htm") {
        let html;
        try {
            html = fs.readFileSync(fsPath, "utf-8");
        } catch {
            send404Page(req, res, stdHeaders);
            return;
        }

        html = injectTwemoji(html);
        const body = Buffer.from(html, "utf-8");

        const etag         = makeETag(finalStat);
        const lastModified  = finalStat.mtime.toUTCString();
        const cacheControl  = getCacheControl(ext);

        const ifNoneMatch = req.headers["if-none-match"];
        if (ifNoneMatch && ifNoneMatch === etag) {
            res.writeHead(304, {
                ...stdHeaders,
                "ETag":          etag,
                "Cache-Control": cacheControl,
                "Last-Modified": lastModified,
            });
            res.end();
            return;
        }

        const ifModifiedSince = req.headers["if-modified-since"];
        if (ifModifiedSince) {
            const since = Date.parse(ifModifiedSince);
            if (!isNaN(since) && Math.floor(finalStat.mtimeMs / 1000) * 1000 <= since) {
                res.writeHead(304, {
                    ...stdHeaders,
                    "ETag":          etag,
                    "Cache-Control": cacheControl,
                    "Last-Modified": lastModified,
                });
                res.end();
                return;
            }
        }

        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "text/html; charset=utf-8",
            "Content-Length": body.length,
            "ETag":           etag,
            "Cache-Control":  cacheControl,
            "Last-Modified":  lastModified,
        });

        if (req.method === "HEAD") {
            res.end();
            return;
        }
        res.end(body);
        return;
    }

    // ── Transparent compressed-variant serving ────────────────────────────────
    // For .png/.gif/.mp4 anywhere under /public: serve the cmpsd/ variant if it
    // exists and is up to date; otherwise serve the original now (low latency)
    // with a short cache and kick off a background build for next time.
    let servingOriginalFallback = false;
    if (COMPRESS_ENABLED && !isInsideCmpsd(fsPath)) {
        const info = getVariantInfo(fsPath);
        if (info) {
            const vStat = cachedStat(info.variantPath);
            if (vStat && vStat.isFile() && vStat.size > 0 && vStat.mtimeMs >= finalStat.mtimeMs) {
                fsPath    = info.variantPath;  // serve the optimized variant
                finalStat = vStat;
            } else {
                servingOriginalFallback = true; // variant missing or stale
                if (!inProgress.has(info.variantPath)) logC(`missing ${relPub(fsPath)} — building variant`);
                scheduleVariantBuild(fsPath, info);
            }
        }
    }

    const finalExt      = path.extname(fsPath).toLowerCase();
    const mimeType      = getMimeType(fsPath);
    const cacheControl  = servingOriginalFallback ? FALLBACK_CACHE : getCacheControl(finalExt);
    const etag          = makeETag(finalStat);
    const lastModified  = finalStat.mtime.toUTCString();
    const highWaterMark = pickHighWaterMark(finalExt);

    // Conditional request: If-None-Match → 304 Not Modified
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
        res.writeHead(304, {
            ...stdHeaders,
            "ETag":          etag,
            "Cache-Control": cacheControl,
            "Last-Modified": lastModified,
        });
        res.end();
        return;
    }

    // Conditional request: If-Modified-Since → 304 Not Modified
    const ifModifiedSince = req.headers["if-modified-since"];
    if (ifModifiedSince) {
        const since = Date.parse(ifModifiedSince);
        if (!isNaN(since) && Math.floor(finalStat.mtimeMs / 1000) * 1000 <= since) {
            res.writeHead(304, {
                ...stdHeaders,
                "ETag":          etag,
                "Cache-Control": cacheControl,
                "Last-Modified": lastModified,
            });
            res.end();
            return;
        }
    }

    // Range request: respond with 206 Partial Content
    const range = parseRange(req.headers.range, finalStat.size);
    if (range) {
        res.writeHead(206, {
            ...stdHeaders,
            "Content-Type":   mimeType,
            "Content-Length": range.end - range.start + 1,
            "Content-Range":  `bytes ${range.start}-${range.end}/${finalStat.size}`,
            "Accept-Ranges":  "bytes",
            "ETag":           etag,
            "Cache-Control":  cacheControl,
            "Last-Modified":  lastModified,
        });

        if (req.method === "HEAD") {
            res.end();
            return;
        }

        const stream = fs.createReadStream(fsPath, {
            start: range.start,
            end:   range.end,
            highWaterMark,
        });
        stream.on("error", () => { try { res.destroy(); } catch {} });
        req.on("close", () => { stream.destroy(); });
        stream.pipe(res);
        return;
    }

    // Malformed Range header — respond 416
    if (req.headers.range && !range) {
        res.writeHead(416, {
            ...stdHeaders,
            "Content-Range": `bytes */${finalStat.size}`,
            "Cache-Control": "no-store",
        });
        res.end();
        return;
    }

    // Full response
    res.writeHead(200, {
        ...stdHeaders,
        "Content-Type":   mimeType,
        "Content-Length": finalStat.size,
        "Accept-Ranges":  "bytes",
        "ETag":           etag,
        "Cache-Control":  cacheControl,
        "Last-Modified":  lastModified,
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const stream = fs.createReadStream(fsPath, { highWaterMark });
    stream.on("error", () => { try { res.destroy(); } catch {} });
    req.on("close", () => { stream.destroy(); });
    stream.pipe(res);
}

module.exports = { serveStaticFile };
