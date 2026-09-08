const fs = require("fs");
const path = require("path");
const { ADMIN_DIR } = require("../constants");
const { getLibrariesRaw, saveLibraries } = require("../siteConfig");
const { statCache } = require("../fsCache");
const { sendJson, readJsonBody, writeJsonFileAtomic } = require("./shared");
const {
    ROOT, fail, segment, libraryFor, readMeta, typeOf, resolveDir, children, tree,
    metadataFile, chainWrites, writeBatch, assertAvailable,
} = require("./libraryTree");

const TEMPLATE = path.join(ADMIN_DIR, "template");

function group(lib, sub, type) {
    return children(lib, sub).filter(item => item.type === type);
}

function scaffold(dir, title, goAfter) {
    fs.mkdirSync(dir);
    try {
        const template = JSON.parse(fs.readFileSync(path.join(TEMPLATE, "blog", "config.json"), "utf8"));
        const config = {
            ...template,
            name: title,
            date: [],
            description: "",
            featured: false,
            goAfter,
            private: false,
        };
        delete config.block;
        delete config.hidden;
        writeJsonFileAtomic(path.join(dir, "config.json"), config);
        fs.copyFileSync(path.join(TEMPLATE, "blog", "content.md"), path.join(dir, "content.md"));
        const index = path.join(TEMPLATE, "blog", "index.html");
        if (fs.existsSync(index)) fs.copyFileSync(index, path.join(dir, "index.html"));
        fs.mkdirSync(path.join(dir, "media"));
    } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}

function createEntry(body, type) {
    const sub = body.sub || "";
    const dir = resolveDir(body.lib, sub, true);
    const name = segment(type === "blog" ? body.filename : body.name);
    assertAvailable(dir, name);
    if (name === "first_blog") fail('"first_blog" is reserved for ordering');
    const items = group(body.lib, sub, type);
    const target = path.join(dir, name);
    const goAfter = items.length ? items[items.length - 1].name : "first_blog";
    if (type === "blog") {
        if (typeof body.title !== "string" || !body.title.trim()) fail("Blog title is required");
        scaffold(target, body.title.trim(), goAfter);
    } else {
        if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
            fail("Folder name is required");
        }
        const title = body.title === undefined ? "" : body.title.trim();
        fs.mkdirSync(target);
        try {
            writeJsonFileAtomic(path.join(target, "folder.json"), { name: title, goAfter });
        } catch (error) {
            fs.rmSync(target, { recursive: true, force: true });
            throw error;
        }
    }
    try {
        if (type === "folder" || libraryFor(body.lib).useDates !== true) {
            writeBatch(chainWrites(dir, [...items, { name, type }]));
        }
    } catch (error) {
        fs.rmSync(target, { recursive: true, force: true });
        throw error;
    }
    return { ok: true, name, urlPath: [body.lib, sub, name].filter(Boolean).join("/") };
}

function reorder(body) {
    const library = libraryFor(body.lib);
    if (library.useDates === true) fail("Drag sorting is disabled for dated libraries");
    if (!["blog", "folder"].includes(body.type)) fail("Invalid entry type");
    const dir = resolveDir(body.lib, body.sub || "", true);
    const items = group(body.lib, body.sub || "", body.type);
    if (JSON.stringify(body.expected) !== JSON.stringify(items.map(item => item.name))) {
        fail("The order changed. Reload and try again.", 409);
    }
    const names = body.order;
    if (!Array.isArray(names) || names.length !== items.length || new Set(names).size !== items.length ||
        names.some(name => !items.some(item => item.name === name))) fail("Invalid sibling order");
    if (names.includes("first_blog")) fail('Rename the folder called "first_blog" before reordering');
    const byName = new Map(items.map(item => [item.name, item]));
    writeBatch(chainWrites(dir, names.map(name => byName.get(name))));
    return { ok: true };
}

function renameEntry(body) {
    const sub = body.sub || "";
    const dir = resolveDir(body.lib, sub, true);
    segment(body.oldName);
    segment(body.newName);
    const items = children(body.lib, sub);
    const item = items.find(entry => entry.name === body.oldName);
    if (!item) fail("Entry not found", 404);
    if (body.oldName === body.newName) return { ok: true, name: body.newName };
    if (body.newName === "first_blog") fail('"first_blog" is reserved for ordering');
    assertAvailable(dir, body.newName);
    const writes = items.filter(entry => entry.type === item.type && entry.name !== item.name).flatMap(entry => {
        const data = readMeta(path.join(dir, entry.name), entry.type);
        return data.goAfter === body.oldName
            ? [{ file: metadataFile(dir, entry), data: { ...data, goAfter: body.newName } }]
            : [];
    });
    const from = path.join(dir, body.oldName);
    const to = path.join(dir, body.newName);
    fs.renameSync(from, to);
    try {
        writeBatch(writes);
    } catch (error) {
        fs.renameSync(to, from);
        throw error;
    }
    return { ok: true, name: body.newName };
}

function removeEntry(body) {
    const sub = body.sub || "";
    const dir = resolveDir(body.lib, sub, true);
    const item = children(body.lib, sub).find(entry => entry.name === body.name && entry.type === body.type);
    if (!item) fail("Entry not found", 404);
    const target = path.join(dir, item.name);
    const staged = path.join(dir, `.delete-${process.pid}-${Date.now()}`);
    const rest = group(body.lib, sub, item.type).filter(entry => entry.name !== item.name);
    fs.renameSync(target, staged);
    try {
        writeBatch(chainWrites(dir, rest));
    } catch (error) {
        fs.renameSync(staged, target);
        throw error;
    }
    try {
        fs.rmSync(staged, { recursive: true, force: true });
    } catch (error) {
        return { ok: true, warning: `Entry removed from the library, but cleanup failed: ${staged}: ${error.message}` };
    }
    return { ok: true };
}

function moveEntry(body) {
    const fromSub = body.fromSub || "";
    const toSub = body.toSub || "";
    const fromDir = resolveDir(body.fromLib, fromSub, true);
    const toDir = resolveDir(body.toLib, toSub, true);
    const item = children(body.fromLib, fromSub).find(entry => entry.name === body.name && entry.type === body.type);
    if (!item) fail("Entry not found", 404);
    if (fromDir === toDir) return { ok: true };
    if (item.name === "first_blog") fail('Rename the folder called "first_blog" before moving');
    const from = path.join(fromDir, item.name);
    const to = path.join(toDir, item.name);
    if (toDir === from || toDir.startsWith(from + path.sep)) fail("Cannot move a folder into itself");
    assertAvailable(toDir, item.name);
    const source = group(body.fromLib, fromSub, item.type).filter(entry => entry.name !== item.name);
    const destination = group(body.toLib, toSub, item.type);
    fs.renameSync(from, to);
    try {
        writeBatch([...chainWrites(fromDir, source), ...chainWrites(toDir, [...destination, item])]);
    } catch (error) {
        fs.renameSync(to, from);
        throw error;
    }
    return { ok: true };
}

function createLibrary(body) {
    const slug = segment(body.path);
    if (["aboutme", "first_blog"].includes(slug.toLowerCase())) fail("Reserved library path");
    if (typeof body.name !== "string" || !body.name.trim()) fail("Name is required");
    const libraries = getLibrariesRaw();
    if (libraries.some(item => String(item.path).toLowerCase() === slug.toLowerCase() || item.id === slug)) {
        fail("Library already exists", 409);
    }
    fs.mkdirSync(ROOT, { recursive: true });
    assertAvailable(ROOT, slug);
    const dir = path.join(ROOT, slug);
    const library = {
        id: slug,
        name: body.name.trim(),
        path: slug,
        useDates: body.useDates === true,
        private: body.private === true,
        icon: typeof body.icon === "string" ? body.icon : "",
    };
    fs.mkdirSync(dir);
    try {
        fs.copyFileSync(path.join(TEMPLATE, "index.html"), path.join(dir, "index.html"));
        writeJsonFileAtomic(path.join(dir, "folder.json"), { name: "", goAfter: "" });
        if (!saveLibraries([...libraries, library])) fail("Failed to save libraries.json", 500);
    } catch (error) {
        fs.rmSync(dir, { recursive: true, force: true });
        throw error;
    }
    return { ok: true, library };
}

function updateLibrary(body) {
    libraryFor(body.path);
    const libraries = getLibrariesRaw();
    const entry = libraries.find(item => item.path === body.path);
    if (typeof body.name === "string") {
        if (!body.name.trim()) fail("Name cannot be empty");
        entry.name = body.name.trim();
    }
    if (typeof body.private === "boolean") {
        entry.private = body.private;
        delete entry.hidden;
    }
    if (typeof body.useDates === "boolean") entry.useDates = body.useDates;
    if (!saveLibraries(libraries)) fail("Failed to save libraries.json", 500);
    return { ok: true, library: entry };
}

function deleteLibrary(body) {
    const dir = resolveDir(body.path);
    const libraries = getLibrariesRaw();
    const remaining = libraries.filter(item => item.path !== body.path);
    if (!saveLibraries(remaining)) fail("Failed to save libraries.json; nothing deleted", 500);
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
        return { ok: true, warning: `Library unlisted, but its folder could not be deleted: ${error.message}` };
    }
    return { ok: true };
}

const actions = {
    folder: body => createEntry(body, "folder"),
    "new-blog": body => createEntry(body, "blog"),
    reorder,
    rename: renameEntry,
    delete: removeEntry,
    move: moveEntry,
    "new-library": createLibrary,
    "update-library": updateLibrary,
    "delete-library": deleteLibrary,
};

async function handleLibraryFsRoutes(req, res, safePath, method) {
    const action = safePath.startsWith("/api/library-fs/") ? safePath.slice("/api/library-fs/".length) : "";
    if (!(safePath === "/api/library-tree" && method === "GET") &&
        !(method === "POST" && Object.hasOwn(actions, action))) return false;
    try {
        let result;
        if (method === "GET") {
            const query = new URL(req.url, "http://internal").searchParams;
            result = tree(query.get("lib"), query.get("sub") || "");
        } else {
            const body = await readJsonBody(req);
            if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid request body");
            result = actions[action](body);
            statCache.clear();
        }
        sendJson(res, 200, result);
    } catch (error) {
        statCache.clear();
        sendJson(res, error.status || 400, { error: error.message });
    }
    return true;
}

module.exports = { handleLibraryFsRoutes };