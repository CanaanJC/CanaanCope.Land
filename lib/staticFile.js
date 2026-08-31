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

function wantsOriginal(req) {
    const raw = req && req.url ? String(req.url) : "";
    const qIndex = raw.indexOf("?");
    if (qIndex === -1) return false;

    let params;
    try {
        params = new URLSearchParams(raw.slice(qIndex + 1));
    } catch {
        return false;
    }

    for (const key of ["orig", "noopt"]) {
        if (!params.has(key)) continue;
        const value = (params.get(key) || "").toLowerCase();
        if (value === "0" || value === "false") continue;
        return true;
    }
    return false;
}

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

function serveStaticFile(req, res, safePath, stdHeaders) {
    let fsPath = resolveFsPath(safePath);

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
        const lastModified = finalStat.mtime.toUTCString();
        const cacheControl = getCacheControl(ext);

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

    let servingOriginalFallback = false;

    if (COMPRESS_ENABLED && !isInsideCmpsd(fsPath)) {
        const info = getVariantInfo(fsPath);
        if (info) {
            const vStat = cachedStat(info.variantPath);
            const variantUsable = vStat && vStat.isFile() && vStat.size > 0 && vStat.mtimeMs >= finalStat.mtimeMs;

            if (!variantUsable) {
                servingOriginalFallback = true;
                if (!inProgress.has(info.variantPath)) logC(`missing ${relPub(fsPath)} — building variant`);
                scheduleVariantBuild(fsPath, info);
            } else if (wantsOriginal(req)) {
                servingOriginalFallback = true;
            } else {
                fsPath    = info.variantPath;
                finalStat = vStat;
            }
        }
    }

    const finalExt      = path.extname(fsPath).toLowerCase();
    const mimeType      = getMimeType(fsPath);
    const cacheControl  = servingOriginalFallback ? FALLBACK_CACHE : getCacheControl(finalExt);
    const etag          = makeETag(finalStat);
    const lastModified  = finalStat.mtime.toUTCString();
    const highWaterMark = pickHighWaterMark(finalExt);

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

    if (req.headers.range && !range) {
        res.writeHead(416, {
            ...stdHeaders,
            "Content-Range": `bytes */${finalStat.size}`,
            "Cache-Control": "no-store",
        });
        res.end();
        return;
    }

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
