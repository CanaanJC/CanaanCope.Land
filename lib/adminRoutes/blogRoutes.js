const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("../constants");
const { sendJson, readJsonBody, writeTextFileAtomic } = require("./shared");
const { invalidateStat } = require("../fsCache");
const { getLibraries } = require("../siteConfig");
const { isSafeSegment } = require("../utils");
const { parseFolderName } = require("../manifest");

// Resolves a blog's content.md path from a "urlPath" (library path + slug
// segments joined by "/", e.g. "template/blog") and a filename, guaranteed
// to stay inside PUBLIC_DIR. Used by /api/blog-file below — deliberately
// only ever allows "content.md" (config.json for a blog is instead edited
// through the existing generic /api/file + resolveSafeJsonPath, since that
// already covers anything under PUBLIC_DIR ending in .json).
function resolveSafeBlogPath(urlPath, filename) {
    if (filename !== "content.md") return null;
    if (typeof urlPath !== "string" || urlPath.length === 0) return null;

    const segments = urlPath.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    if (!segments.every(isSafeSegment)) return null;

    const resolved = path.resolve(PUBLIC_DIR, "libraries", ...segments, filename);
    const rootWithSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
    if (!resolved.startsWith(rootWithSep)) return null;

    return resolved;
}

// ── Blog discovery (Blog Editor) ──────────────────────────────────────────
//
// Walks a library's folder tree down to `library.depth` levels, same shape
// as lib/manifest.js's walkLevel(), but a leaf counts as a "blog" if it has
// a content.md file (rather than manifest.js's rule of requiring
// config.json) — this is purely presence-based, per the Blog Editor's own
// spec, and intentionally does NOT respect a leaf's `block` flag (the
// editor should still be able to open a blocked entry to un-block it).

function listDirsSorted(dirPath) {
    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

function walkBlogLevel(dirPath, remainingDepth, parentSlugs, out, libraryPath) {
    for (const folderName of listDirsSorted(dirPath)) {
        const folderPath = path.join(dirPath, folderName);
        const slugPath    = [...parentSlugs, folderName];

        if (remainingDepth === 1) {
            const contentPath = path.join(folderPath, "content.md");
            if (!fs.existsSync(contentPath)) continue; // not a blog — skip

            let name = null;
            const configPath = path.join(folderPath, "config.json");
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                if (config && typeof config.name === "string" && config.name.trim()) {
                    name = config.name.trim();
                }
            } catch {
                // no/invalid config.json — fall back to the folder name below
            }
            if (!name) {
                name = parseFolderName(folderName).title;
            }

            out.push({
                slugPath,
                name,
                urlPath: [libraryPath, ...slugPath].join("/"),
            });
        } else {
            walkBlogLevel(folderPath, remainingDepth - 1, slugPath, out, libraryPath);
        }
    }
}

function walkBlogsForLibrary(library) {
    const baseDir = path.join(PUBLIC_DIR, "libraries", library.path);
    const out = [];
    walkBlogLevel(baseDir, library.depth, [], out, library.path);
    return out;
}

async function handleBlogRoutes(req, res, safePath, method) {
    // ── Blog Editor: blog discovery ───────────────────────────────────────
    // Every configured library, each with its list of blog entries found
    // by walking public/{library.path} to library.depth and checking for
    // content.md presence (see walkBlogsForLibrary above). Entry names
    // come from that entry's own config.json "name" field if present, else
    // a formatted version of the folder name (matches lib/manifest.js's
    // own folder-name parsing).
    if (safePath === "/api/blog-list" && method === "GET") {
        try {
            const libraries = getLibraries();
            const result = libraries.map((library) => ({
                libraryId:   library.id || library.path,
                libraryName: library.name || library.path,
                libraryPath: library.path,
                blogs:       walkBlogsForLibrary(library),
            }));
            sendJson(res, 200, result);
        } catch (e) {
            sendJson(res, 500, { error: `Failed to list blogs: ${e.message}` });
        }
        return true;
    }

    // ── Blog Editor: content.md read/write ────────────────────────────────
    // ?path= is a library-path + slug segments joined by "/" (e.g.
    // "template/blog"), resolved safely under PUBLIC_DIR via
    // resolveSafeBlogPath. ?file= must be exactly "content.md" — config.json
    // editing goes through the generic /api/file endpoint above instead
    // (target = "public/<path>/config.json"), since that already covers
    // arbitrary .json files under the project root and gets the full
    // shared JSON-editor UI for free.
    if (safePath === "/api/blog-file" && method === "GET") {
        const query    = new URL(req.url, "http://internal").searchParams;
        const urlPath  = query.get("path");
        const file     = query.get("file");
        const filePath = resolveSafeBlogPath(urlPath, file);

        if (!filePath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"file\" query parameters (file must be content.md)" });
            return true;
        }

        try {
            const content = fs.readFileSync(filePath, "utf-8");
            sendJson(res, 200, { content });
        } catch (e) {
            sendJson(res, 404, { error: `Failed to read "${urlPath}/${file}": ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/blog-file" && method === "PUT") {
        const query    = new URL(req.url, "http://internal").searchParams;
        const urlPath  = query.get("path");
        const file     = query.get("file");
        const filePath = resolveSafeBlogPath(urlPath, file);

        if (!filePath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\"/\"file\" query parameters (file must be content.md)" });
            return true;
        }

        try {
            const data = await readJsonBody(req);
            if (!data || typeof data.content !== "string") {
                sendJson(res, 400, { error: "Body must be an object with a \"content\" string" });
                return true;
            }
            // Atomic write (temp file + rename), same safety guarantee as
            // every other on-disk write in this file.
            writeTextFileAtomic(filePath, data.content);
            invalidateStat(filePath);
            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleBlogRoutes, resolveSafeBlogPath, walkBlogsForLibrary };
