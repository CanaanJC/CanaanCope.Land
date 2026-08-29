const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR, CMPSD_DIRNAME } = require("../constants");
const { MEDIA_EXT_RE, MAX_MEDIA_UPLOAD_BYTES } = require("./constants");
const { sendJson, readBody, readJsonBody } = require("./shared");
const { invalidateStat } = require("../fsCache");
const { isSafeSegment } = require("../utils");

// ── Blog media manager path resolution ────────────────────────────────────
//
// Resolves a blog's "urlPath" (library path + slug segments, e.g.
// "template/blog") + an optional "sub" path (subfolder segments joined by
// "/", relative to that blog's own media/ folder, e.g. "figs2/nested") to
// an absolute directory, guaranteed to stay inside PUBLIC_DIR. Returns null
// on anything unsafe. This is the ONLY entry point every blog-media
// endpoint below uses to turn client-supplied paths into real filesystem
// paths — nothing else touches disk without going through this first.
function resolveSafeMediaDir(urlPath, subPath) {
    if (typeof urlPath !== "string" || urlPath.length === 0) return null;
    const segments = urlPath.split("/").filter(Boolean);
    if (segments.length === 0 || !segments.every(isSafeSegment)) return null;

    const subSegments = String(subPath || "").split("/").filter(Boolean);
    if (!subSegments.every(isSafeSegment)) return null;

    const resolved = path.resolve(PUBLIC_DIR, ...segments, "media", ...subSegments);
    const rootWithSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
    if (resolved !== PUBLIC_DIR && !resolved.startsWith(rootWithSep)) return null;

    return resolved;
}

// Scans `dirPath` for existing "folderN" subfolders (case-insensitive) and
// returns the lowest unused N (starting at 1) as "folderN" — e.g. if
// folder1 and folder2 both exist, returns "folder3"; if only folder2
// exists (folder1 was deleted/renamed), returns "folder1".
function nextFolderName(dirPath) {
    let entries = [];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch {}

    const used = new Set();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const m = entry.name.match(/^folder(\d+)$/i);
        if (m) used.add(parseInt(m[1], 10));
    }

    let n = 1;
    while (used.has(n)) n++;
    return `folder${n}`;
}

// Lists a blog media directory's contents: real subfolders (excluding the
// server's own "cmpsd" compressed-variant cache folder — never rendered or
// touchable here) and supported media files only (per MEDIA_EXT_RE).
// Dotfiles/AppleDouble junk (._*) and anything else (config.json,
// content.md, unsupported extensions) are always excluded. Both lists are
// naturally sorted.
function listMediaDir(dirPath) {
    let entries = [];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch {}

    const folders = [];
    const files = [];

    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        if (entry.isDirectory()) {
            if (entry.name === CMPSD_DIRNAME) continue;
            folders.push(entry.name);
        } else if (entry.isFile()) {
            if (!MEDIA_EXT_RE.test(entry.name)) continue;
            files.push({ name: entry.name, ext: path.extname(entry.name).toLowerCase() });
        }
    }

    const collator = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    folders.sort(collator);
    files.sort((a, b) => collator(a.name, b.name));

    return { folders, files };
}

async function handleBlogMediaRoutes(req, res, safePath, method) {
    // ── Blog Editor: media manager (list / upload / new folder / rename /
    // delete / move) — everything scoped strictly to a single blog's own
    // media/ folder (and its subfolders), via resolveSafeMediaDir above. ──

    if (safePath === "/api/blog-media" && method === "GET") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const dirPath = resolveSafeMediaDir(query.get("path"), query.get("sub"));

        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"sub\" query parameters" });
            return true;
        }

        try {
            sendJson(res, 200, listMediaDir(dirPath));
        } catch (e) {
            sendJson(res, 500, { error: `Failed to list media: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/blog-media/upload" && method === "POST") {
        const query       = new URL(req.url, "http://internal").searchParams;
        const dirPath     = resolveSafeMediaDir(query.get("path"), query.get("sub"));
        const rawFilename = query.get("filename") || "";
        const overwrite   = query.get("overwrite") === "true";

        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"sub\" query parameters" });
            return true;
        }

        // Basename-only — never trusts any directory portion the client
        // might have sent in "filename". Extension re-validated server-side
        // regardless of the client's <input accept> filter.
        const filename = path.basename(rawFilename);
        if (!filename || !MEDIA_EXT_RE.test(filename)) {
            sendJson(res, 400, { error: "Missing filename or unsupported file type" });
            return true;
        }

        const destPath = path.join(dirPath, filename);
        if (fs.existsSync(destPath) && !overwrite) {
            sendJson(res, 409, { exists: true });
            return true;
        }

        try {
            // Blog media (images/video/audio/3D models) gets a much higher
            // cap than the small-asset uploads elsewhere (icons/logo/fonts)
            // — see MAX_MEDIA_UPLOAD_BYTES. On exceeding it, readBody
            // rejects with a PAYLOAD_TOO_LARGE code WITHOUT killing the
            // socket, so this actually reaches the client instead of the
            // upload just silently hanging/disappearing.
            const buf = await readBody(req, MAX_MEDIA_UPLOAD_BYTES);
            if (buf.length === 0) {
                sendJson(res, 400, { error: "Empty upload" });
                return true;
            }
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(destPath, buf);
            invalidateStat(destPath);
            sendJson(res, 200, { ok: true, name: filename });
        } catch (e) {
            if (e.code === "PAYLOAD_TOO_LARGE") {
                const maxMb = Math.round(MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024));
                sendJson(res, 413, { error: `File too large — max ${maxMb}MB per file` });
            } else {
                sendJson(res, 500, { error: `Upload failed: ${e.message}` });
            }
        }
        return true;
    }

    if (safePath === "/api/blog-media/folder" && method === "POST") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const dirPath = resolveSafeMediaDir(query.get("path"), query.get("sub"));

        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"sub\" query parameters" });
            return true;
        }

        try {
            fs.mkdirSync(dirPath, { recursive: true });
            const name = nextFolderName(dirPath);
            fs.mkdirSync(path.join(dirPath, name));
            sendJson(res, 200, { ok: true, name });
        } catch (e) {
            sendJson(res, 500, { error: `Failed to create folder: ${e.message}` });
        }
        return true;
    }

    // Body: { oldName, newName, type: "file"|"folder" }. ?path=/?sub=
    // identify which directory both names live in (rename never moves
    // anything between directories — see /api/blog-media/move for that).
    if (safePath === "/api/blog-media/rename" && method === "POST") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const dirPath = resolveSafeMediaDir(query.get("path"), query.get("sub"));

        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"sub\" query parameters" });
            return true;
        }

        try {
            const body = await readJsonBody(req);
            const oldName = body && body.oldName;
            const newName = body && body.newName;
            const type    = body && body.type;

            if (!isSafeSegment(oldName) || !isSafeSegment(newName)) {
                sendJson(res, 400, { error: "Invalid file/folder name" });
                return true;
            }
            if (type === "file" && !MEDIA_EXT_RE.test(newName)) {
                sendJson(res, 400, { error: "Unsupported file type" });
                return true;
            }

            const oldPath = path.join(dirPath, oldName);
            const newPath = path.join(dirPath, newName);

            if (!fs.existsSync(oldPath)) {
                sendJson(res, 404, { error: "Original file/folder not found" });
                return true;
            }
            if (oldName.toLowerCase() !== newName.toLowerCase() && fs.existsSync(newPath)) {
                sendJson(res, 409, { error: "A file or folder with that name already exists" });
                return true;
            }

            fs.renameSync(oldPath, newPath);
            invalidateStat(oldPath);
            invalidateStat(newPath);
            sendJson(res, 200, { ok: true, name: newName });
        } catch (e) {
            sendJson(res, 400, { error: `Rename failed: ${e.message}` });
        }
        return true;
    }

    // ── Delete a file or folder — sibling to rename above ─────────────────
    // Body: { name, type: "file"|"folder" }. ?path=/?sub= identify which
    // directory `name` lives in (same scoping as rename/list/upload — never
    // touches anything outside this one blog's own media/ tree). Folder
    // deletes are recursive (removes everything inside it too) — the
    // confirm dialog on the client is expected to make that clear before
    // calling this. Deleting something that's already gone is treated as
    // success (idempotent), not an error.
    if (safePath === "/api/blog-media/delete" && method === "POST") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const dirPath = resolveSafeMediaDir(query.get("path"), query.get("sub"));

        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"sub\" query parameters" });
            return true;
        }

        try {
            const body = await readJsonBody(req);
            const name = body && body.name;
            const type = body && body.type;

            if (!isSafeSegment(name)) {
                sendJson(res, 400, { error: "Invalid file/folder name" });
                return true;
            }
            if (type !== "file" && type !== "folder") {
                sendJson(res, 400, { error: "\"type\" must be \"file\" or \"folder\"" });
                return true;
            }

            const targetPath = path.join(dirPath, name);

            let stat;
            try { stat = fs.statSync(targetPath); } catch { stat = null; }

            if (!stat) {
                // Already gone — treat as success rather than erroring, so
                // a double-click/retry on the client never surfaces a
                // confusing "not found" for something that's already deleted.
                sendJson(res, 200, { ok: true, name });
                return true;
            }

            if (type === "folder" && !stat.isDirectory()) {
                sendJson(res, 400, { error: "\"name\" is not a folder" });
                return true;
            }
            if (type === "file" && !stat.isFile()) {
                sendJson(res, 400, { error: "\"name\" is not a file" });
                return true;
            }

            fs.rmSync(targetPath, { recursive: true, force: true });
            invalidateStat(targetPath);
            sendJson(res, 200, { ok: true, name });
        } catch (e) {
            sendJson(res, 400, { error: `Delete failed: ${e.message}` });
        }
        return true;
    }

    // Body: { path, name, type: "file"|"folder", fromSub, toSub }. Moves a
    // single file or folder between any two subfolders of the SAME blog's
    // media/ tree (including to/from the media/ root itself, via an empty
    // "" sub). Refuses to move a folder into itself or one of its own
    // descendants.
    if (safePath === "/api/blog-media/move" && method === "POST") {
        try {
            const body = await readJsonBody(req);
            const urlPath = body && body.path;
            const name    = body && body.name;
            const type    = body && body.type;
            const fromSub = body && body.fromSub;
            const toSub   = body && body.toSub;

            const fromDir = resolveSafeMediaDir(urlPath, fromSub);
            const toDir   = resolveSafeMediaDir(urlPath, toSub);

            if (!fromDir || !toDir || !isSafeSegment(name)) {
                sendJson(res, 400, { error: "Invalid move request" });
                return true;
            }

            const fromPath = path.join(fromDir, name);
            const toPath   = path.join(toDir, name);

            if (!fs.existsSync(fromPath)) {
                sendJson(res, 404, { error: "Source file/folder not found" });
                return true;
            }
            if (fromPath !== toPath && fs.existsSync(toPath)) {
                sendJson(res, 409, { error: "A file or folder with that name already exists in the destination" });
                return true;
            }

            if (type === "folder") {
                const fromResolved = path.resolve(fromPath) + path.sep;
                const toResolved   = path.resolve(toDir) + path.sep;
                if (toResolved.startsWith(fromResolved)) {
                    sendJson(res, 400, { error: "Cannot move a folder into itself" });
                    return true;
                }
            }

            fs.mkdirSync(toDir, { recursive: true });
            fs.renameSync(fromPath, toPath);
            invalidateStat(fromPath);
            invalidateStat(toPath);
            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: `Move failed: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleBlogMediaRoutes, resolveSafeMediaDir, nextFolderName, listMediaDir };
