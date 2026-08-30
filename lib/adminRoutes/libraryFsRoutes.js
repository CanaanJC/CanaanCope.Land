const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR, ADMIN_DIR } = require("../constants");
const { sendJson, readJsonBody } = require("./shared");
const { invalidateStat } = require("../fsCache");
const { getLibraries, getLibrariesRaw, saveLibraries } = require("../siteConfig");
const { isSafeSegment } = require("../utils");
const { parseFolderName } = require("../manifest");

const LIBRARIES_ROOT = path.join(PUBLIC_DIR, "libraries");
const TEMPLATE_INDEX_PATH = path.join(ADMIN_DIR, "template", "index.html");
const TEMPLATE_BLOG_DIR   = path.join(ADMIN_DIR, "template", "blog");

// Files that MUST be copied from ADMIN/template/blog/ for a new blog to be
// considered successfully scaffolded. If any one of them can't be copied
// (missing template, permissions, disk error), the whole freshly-created
// folder is removed again so a half-built blog never lingers on disk.
const REQUIRED_BLOG_FILES = ["config.json", "content.md"];
// Copied if present, but never fatal — the server generates this page
// dynamically anyway (see lib/routes.js + lib/embed.js).
const OPTIONAL_BLOG_FILES = ["index.html"];

function findLibrary(libPath) {
    return getLibraries().find((l) => l.path === libPath) || null;
}

// Resolves a library path + slash-joined sub segments to an absolute
// directory guaranteed to stay inside public/libraries/. Returns null on
// anything unsafe.
function resolveSafeLibDir(libPath, sub) {
    if (typeof libPath !== "string" || !isSafeSegment(libPath)) return null;
    const subSegments = String(sub || "").split("/").filter(Boolean);
    if (!subSegments.every(isSafeSegment)) return null;

    const resolved = path.resolve(LIBRARIES_ROOT, libPath, ...subSegments);
    const rootWithSep = LIBRARIES_ROOT.endsWith(path.sep) ? LIBRARIES_ROOT : LIBRARIES_ROOT + path.sep;
    if (resolved !== LIBRARIES_ROOT && !resolved.startsWith(rootWithSep)) return null;

    return resolved;
}

const naturalCollator = (a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function listDirsSorted(dirPath) {
    let entries = [];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch {}
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => !name.startsWith("."))
        .sort(naturalCollator);
}

function readBlogConfig(folderPath) {
    try {
        return JSON.parse(fs.readFileSync(path.join(folderPath, "config.json"), "utf-8"));
    } catch {
        return null;
    }
}

function blogDisplayName(folderPath, folderName, config) {
    const cfg = config !== undefined ? config : readBlogConfig(folderPath);
    if (cfg && typeof cfg.name === "string" && cfg.name.trim()) return cfg.name.trim();
    return parseFolderName(folderName).title;
}

// ── Date parsing / blog ordering ──────────────────────────────────────────
//
// A blog's config.json may carry a "date" array like:
//   "date": ["2025/12/10", "2025/12/15"]
// The FIRST entry is what determines its position in the library explorer.
// Anything unparseable (or an empty/missing array) counts as "no date".
function firstDateValue(config) {
    if (!config || !Array.isArray(config.date) || config.date.length === 0) return null;
    const raw = config.date[0];
    if (typeof raw !== "string" || !raw.trim()) return null;
    const normalized = raw.trim().replace(/\//g, "-");
    const parsed = Date.parse(normalized);
    return isNaN(parsed) ? null : parsed;
}

// Dated blogs first, newest → oldest. Every undated blog goes after all the
// dated ones, sorted naturally by its FOLDER NAME. When a library has
// useDates === false, dates are ignored entirely and everything is sorted
// by folder name.
function sortBlogItems(items, useDates) {
    if (!useDates) {
        items.sort((a, b) => naturalCollator(a.name, b.name));
        return items;
    }

    items.sort((a, b) => {
        const aHas = a._date !== null;
        const bHas = b._date !== null;
        if (aHas && bHas) {
            if (b._date !== a._date) return b._date - a._date; // newest first
            return naturalCollator(a.name, b.name);
        }
        if (aHas) return -1;
        if (bHas) return 1;
        return naturalCollator(a.name, b.name);
    });
    return items;
}

function sanitizeSlug(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Folder names typed directly by the user (the "File name" field on the New
// Blog dialog). Preserves case and underscores — only strips characters
// that would be unsafe/awkward in a URL segment or on disk.
function sanitizeFolderName(raw) {
    return String(raw || "")
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");
}

// Scaffolds a brand-new blog folder from ADMIN/template/blog/.
// Throws on ANY failure copying a required file (config.json / content.md)
// or creating media/ — the caller is responsible for deleting the folder.
function scaffoldBlogFolder(targetDir, title) {
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of REQUIRED_BLOG_FILES) {
        const src = path.join(TEMPLATE_BLOG_DIR, file);
        if (!fs.existsSync(src)) {
            throw new Error(`template file "ADMIN/template/blog/${file}" is missing`);
        }
        fs.copyFileSync(src, path.join(targetDir, file));
    }

    for (const file of OPTIONAL_BLOG_FILES) {
        const src = path.join(TEMPLATE_BLOG_DIR, file);
        try {
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(targetDir, file));
        } catch {
            // Non-fatal by design.
        }
    }

    // Empty media/ folder, ready for the media manager to upload into.
    fs.mkdirSync(path.join(targetDir, "media"), { recursive: true });

    // The blog TITLE (separate from the folder/file name) goes straight
    // into the copied config.json's own "name" field.
    if (title) {
        const configPath = path.join(targetDir, "config.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        config.name = title;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
    }
}

async function handleLibraryFsRoutes(req, res, safePath, method) {
    // ── List one level of a library's tree ──────────────────────────────────
    if (safePath === "/api/library-tree" && method === "GET") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const libPath = query.get("lib") || "";
        const sub     = query.get("sub") || "";

        const library = findLibrary(libPath);
        if (!library) {
            sendJson(res, 400, { error: "Unknown library" });
            return true;
        }

        const dirPath = resolveSafeLibDir(libPath, sub);
        if (!dirPath) {
            sendJson(res, 400, { error: "Invalid \"lib\"/\"sub\" query parameters" });
            return true;
        }

        const level = String(sub || "").split("/").filter(Boolean).length;
        const isLeafLevel = level === library.depth - 1;

        if (isLeafLevel) {
            const items = [];
            const subSegments = String(sub || "").split("/").filter(Boolean);
            for (const name of listDirsSorted(dirPath)) {
                const folderPath = path.join(dirPath, name);
                if (!fs.existsSync(path.join(folderPath, "content.md"))) continue;
                const config = readBlogConfig(folderPath);
                items.push({
                    name,
                    displayName: blogDisplayName(folderPath, name, config),
                    urlPath: [libPath, ...subSegments, name].join("/"),
                    _date: firstDateValue(config),
                });
            }

            sortBlogItems(items, library.useDates !== false);
            for (const item of items) delete item._date;

            sendJson(res, 200, { type: "blogs", items, level, depth: library.depth });
        } else {
            const items = listDirsSorted(dirPath).map((name) => ({ name }));
            sendJson(res, 200, { type: "folders", items, level, depth: library.depth });
        }
        return true;
    }

    // ── Create a plain folder — never allowed at the leaf/blog level ────────
    if (safePath === "/api/library-fs/folder" && method === "POST") {
        try {
            const body    = await readJsonBody(req);
            const libPath = body && body.lib;
            const sub     = (body && body.sub) || "";
            const name    = body && body.name;

            const library = findLibrary(libPath);
            if (!library) { sendJson(res, 400, { error: "Unknown library" }); return true; }

            const level = String(sub || "").split("/").filter(Boolean).length;
            if (level >= library.depth - 1) {
                sendJson(res, 400, { error: "Cannot create a folder at the blog level" });
                return true;
            }

            const dirPath = resolveSafeLibDir(libPath, sub);
            if (!dirPath || !isSafeSegment(name)) {
                sendJson(res, 400, { error: "Invalid request" });
                return true;
            }

            const target = path.join(dirPath, name);
            if (fs.existsSync(target)) {
                sendJson(res, 409, { error: "A folder with that name already exists" });
                return true;
            }

            fs.mkdirSync(target, { recursive: true });
            invalidateStat(target);
            sendJson(res, 200, { ok: true, name });
        } catch (e) {
            sendJson(res, 400, { error: `Failed to create folder: ${e.message}` });
        }
        return true;
    }

    // ── Create a brand new blog — only allowed AT the leaf/blog level ───────
    //
    // Body: { lib, sub, filename, title }
    //   filename → the folder name on disk / URL segment
    //   title    → written into the copied config.json's "name" field
    //
    // Copies ADMIN/template/blog/config.json + content.md and creates an
    // empty media/ folder. If ANY of that fails, the folder that was just
    // created is deleted again so nothing half-built is left behind.
    if (safePath === "/api/library-fs/new-blog" && method === "POST") {
        try {
            const body     = await readJsonBody(req);
            const libPath  = body && body.lib;
            const sub      = (body && body.sub) || "";
            const title    = ((body && body.title) || "").trim();
            const rawName  = ((body && body.filename) || "").trim();

            const library = findLibrary(libPath);
            if (!library) { sendJson(res, 400, { error: "Unknown library" }); return true; }

            const level = String(sub || "").split("/").filter(Boolean).length;
            if (level !== library.depth - 1) {
                sendJson(res, 400, { error: "Blogs can only be created at this library's deepest folder level" });
                return true;
            }

            if (!title) {
                sendJson(res, 400, { error: "Blog title is required" });
                return true;
            }

            // Prefer the explicit file name; fall back to a slug of the
            // title only if no file name was supplied at all.
            const folderName = sanitizeFolderName(rawName) || sanitizeSlug(title);
            if (!folderName || !isSafeSegment(folderName)) {
                sendJson(res, 400, { error: "File name produced an empty or unsafe folder name" });
                return true;
            }

            const dirPath = resolveSafeLibDir(libPath, sub);
            if (!dirPath) {
                sendJson(res, 400, { error: "Invalid request" });
                return true;
            }

            const target = path.join(dirPath, folderName);
            if (fs.existsSync(target)) {
                sendJson(res, 409, { error: "A folder with that name already exists" });
                return true;
            }

            try {
                scaffoldBlogFolder(target, title);
            } catch (scaffoldError) {
                // Roll back completely — a blog that's missing its
                // config.json/content.md/media folder is worse than no
                // blog at all.
                try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
                invalidateStat(target);
                sendJson(res, 500, { error: `Failed to scaffold blog (nothing was created): ${scaffoldError.message}` });
                return true;
            }

            invalidateStat(target);

            const subSegments = String(sub || "").split("/").filter(Boolean);
            const urlPath = [libPath, ...subSegments, folderName].join("/");
            sendJson(res, 200, { ok: true, name: folderName, title, urlPath });
        } catch (e) {
            sendJson(res, 400, { error: `Failed to create blog: ${e.message}` });
        }
        return true;
    }

    // ── Rename a folder OR a blog folder — same directory, never moves ──────
    if (safePath === "/api/library-fs/rename" && method === "POST") {
        try {
            const body    = await readJsonBody(req);
            const libPath = body && body.lib;
            const sub     = (body && body.sub) || "";
            const oldName = body && body.oldName;
            const newName = body && body.newName;

            const dirPath = resolveSafeLibDir(libPath, sub);
            if (!dirPath || !isSafeSegment(oldName) || !isSafeSegment(newName)) {
                sendJson(res, 400, { error: "Invalid rename request" });
                return true;
            }

            const oldPath = path.join(dirPath, oldName);
            const newPath = path.join(dirPath, newName);

            if (!fs.existsSync(oldPath)) {
                sendJson(res, 404, { error: "Original folder not found" });
                return true;
            }
            if (oldName.toLowerCase() !== newName.toLowerCase() && fs.existsSync(newPath)) {
                sendJson(res, 409, { error: "A folder with that name already exists" });
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

    // ── Delete a folder or blog — recursive, irreversible. ──────────────────
    if (safePath === "/api/library-fs/delete" && method === "POST") {
        try {
            const body    = await readJsonBody(req);
            const libPath = body && body.lib;
            const sub     = (body && body.sub) || "";
            const name    = body && body.name;
            const type    = body && body.type; // "folder" | "blog"

            const dirPath = resolveSafeLibDir(libPath, sub);
            if (!dirPath || !isSafeSegment(name) || (type !== "folder" && type !== "blog")) {
                sendJson(res, 400, { error: "Invalid delete request" });
                return true;
            }

            const target = path.join(dirPath, name);
            fs.rmSync(target, { recursive: true, force: true });
            invalidateStat(target);
            sendJson(res, 200, { ok: true, name });
        } catch (e) {
            sendJson(res, 400, { error: `Delete failed: ${e.message}` });
        }
        return true;
    }

    // ── Move a folder/blog, validated against the destination's depth ──────
    if (safePath === "/api/library-fs/move" && method === "POST") {
        try {
            const body    = await readJsonBody(req);
            const fromLib = body && body.fromLib;
            const fromSub = (body && body.fromSub) || "";
            const name    = body && body.name;
            const type    = body && body.type; // "folder" | "blog"
            const toLib   = body && body.toLib;
            const toSub   = (body && body.toSub) || "";

            const fromLibrary = findLibrary(fromLib);
            const toLibrary   = findLibrary(toLib);
            if (!fromLibrary || !toLibrary) {
                sendJson(res, 400, { error: "Unknown library" });
                return true;
            }

            const fromDir = resolveSafeLibDir(fromLib, fromSub);
            const toDir   = resolveSafeLibDir(toLib, toSub);
            if (!fromDir || !toDir || !isSafeSegment(name)) {
                sendJson(res, 400, { error: "Invalid move request" });
                return true;
            }

            const toLevel = String(toSub || "").split("/").filter(Boolean).length;
            const isLeafDestination = toLevel === toLibrary.depth - 1;

            if (type === "blog" && !isLeafDestination) {
                sendJson(res, 400, { error: "Blogs can only be moved into the deepest folder level" });
                return true;
            }
            if (type === "folder" && isLeafDestination) {
                sendJson(res, 400, { error: "Cannot move a folder into the blog level" });
                return true;
            }

            const fromPath = path.join(fromDir, name);
            const toPath   = path.join(toDir, name);

            if (!fs.existsSync(fromPath)) {
                sendJson(res, 404, { error: "Source not found" });
                return true;
            }
            if (fromPath !== toPath && fs.existsSync(toPath)) {
                sendJson(res, 409, { error: "Something with that name already exists at the destination" });
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

    // ── Create a brand new library ─────────────────────────────────────────
    //
    // Body: { path, name, depth, useDates, icon }
    //   path     → URL segment AND the folder name on disk; `id` mirrors it
    //   name     → display name shown on the website
    //   depth    → integer > 0
    //   useDates → true = sort by blog date, false = sort by file name
    //   icon     → optional public-relative path (already uploaded via
    //              /api/upload/library)
    if (safePath === "/api/library-fs/new-library" && method === "POST") {
        try {
            const body = await readJsonBody(req);

            const rawPath = ((body && body.path) || "").trim();
            const name    = ((body && body.name) || "").trim();
            const icon    = ((body && body.icon) || "").trim();
            const depth   = parseInt(body && body.depth, 10);
            const useDates = body && body.useDates !== false;

            if (!name) {
                sendJson(res, 400, { error: "Name is required" });
                return true;
            }

            const slug = sanitizeSlug(rawPath || name);
            if (!slug || !isSafeSegment(slug)) {
                sendJson(res, 400, { error: "Path produced an empty or unsafe slug" });
                return true;
            }

            if (!Number.isFinite(depth) || depth < 1) {
                sendJson(res, 400, { error: "Depth must be a whole number greater than 0" });
                return true;
            }

            const libraries = getLibrariesRaw();
            if (libraries.some((l) => l.path === slug || l.id === slug)) {
                sendJson(res, 409, { error: "A library with that path already exists" });
                return true;
            }

            const targetDir = path.join(LIBRARIES_ROOT, slug);
            if (fs.existsSync(targetDir)) {
                sendJson(res, 409, { error: "That folder already exists on disk" });
                return true;
            }

            fs.mkdirSync(targetDir, { recursive: true });
            try {
                const templateHtml = fs.readFileSync(TEMPLATE_INDEX_PATH, "utf-8");
                fs.writeFileSync(path.join(targetDir, "index.html"), templateHtml);
            } catch {
                // Template missing — folder still gets created; the
                // libraries.json entry below is what actually matters.
            }

            const newEntry = {
                id: slug,
                name,
                path: slug,
                depth,
                useDates,
                icon: icon || "",
            };
            libraries.push(newEntry);
            const ok = saveLibraries(libraries);

            if (!ok) {
                // Roll back the folder so libraries.json and disk can't
                // silently disagree.
                try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
                sendJson(res, 500, { error: "Failed to write libraries.json" });
                return true;
            }

            invalidateStat(targetDir);
            sendJson(res, 200, { ok: true, library: newEntry });
        } catch (e) {
            sendJson(res, 400, { error: `Failed to create library: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleLibraryFsRoutes };
