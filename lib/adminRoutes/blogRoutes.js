const fs = require("fs");
const path = require("path");
const { sendJson, readJsonBody, writeTextFileAtomic } = require("./shared");
const { invalidateStat } = require("../fsCache");
const { getLibraries } = require("../siteConfig");
const { walkBlogsForLibrary, resolveDir, typeOf } = require("./libraryTree");
const { isAboutMePath, ABOUT_ME_CONTENT, ensureAboutMe } = require("../aboutMe");

function resolveSafeBlogPath(urlPath, filename) {
    if (filename !== "content.md") return null;
    if (typeof urlPath !== "string" || urlPath.length === 0) return null;

    if (isAboutMePath(urlPath)) {
        ensureAboutMe();
        return ABOUT_ME_CONTENT;
    }

    const [lib, ...parts] = urlPath.split("/");
    try {
        const dir = resolveDir(lib, parts.join("/"));
        if (typeOf(dir) !== "blog") return null;
        const file = path.join(dir, filename);
        if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) return null;
        return file;
    } catch {
        return null;
    }
}

async function handleBlogRoutes(req, res, safePath, method) {
    if (safePath === "/api/blog-list" && method === "GET") {
        try {
            const libraries = getLibraries();
            const result = libraries.map((library) => ({
                libraryId: library.id || library.path,
                libraryName: library.name || library.path,
                libraryPath: library.path,
                blogs: walkBlogsForLibrary(library),
            }));
            sendJson(res, 200, result);
        } catch (e) {
            sendJson(res, 500, { error: `Failed to list blogs: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/blog-file" && method === "GET") {
        const query = new URL(req.url, "http://internal").searchParams;
        const urlPath = query.get("path");
        const file = query.get("file");
        const filePath = resolveSafeBlogPath(urlPath, file);

        if (!filePath) {
            sendJson(res, 400, {
                error: "Invalid or missing \"path\"/\"file\" query parameters (file must be content.md)",
            });
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
        const query = new URL(req.url, "http://internal").searchParams;
        const urlPath = query.get("path");
        const file = query.get("file");
        const filePath = resolveSafeBlogPath(urlPath, file);

        if (!filePath) {
            sendJson(res, 400, {
                error: "Invalid or missing \"path\"/\"file\" query parameters (file must be content.md)",
            });
            return true;
        }

        try {
            const data = await readJsonBody(req);
            if (!data || typeof data.content !== "string") {
                sendJson(res, 400, { error: "Body must be an object with a \"content\" string" });
                return true;
            }
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