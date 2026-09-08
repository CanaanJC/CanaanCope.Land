const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("../constants");
const { getLibraries } = require("../siteConfig");
const { naturalCompare, orderSiblings } = require("../sortOrder");
const { writeJsonFileAtomic } = require("./shared");
const { statCache } = require("../fsCache");

const ROOT = path.join(PUBLIC_DIR, "libraries");

function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

function segment(value) {
    if (typeof value !== "string" || !value || value.trim() !== value ||
        /[\\/\x00-\x1f]/.test(value) || value.startsWith(".") || value === "media") {
        fail("Invalid folder name");
    }
    return value;
}

function libraryFor(lib) {
    segment(lib);
    const library = getLibraries().find(item => item.path === lib);
    if (!library) fail("Unknown library", 404);
    return library;
}

function readMeta(dir, type) {
    const file = path.join(dir, type === "blog" ? "config.json" : "folder.json");
    let text;
    try {
        if (fs.lstatSync(file).isSymbolicLink()) fail("Symbolic-link metadata is not supported");
        text = fs.readFileSync(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT" && type === "folder") {
            const data = { name: "", goAfter: "" };
            writeJsonFileAtomic(file, data);
            statCache.clear();
            return data;
        }
        throw error;
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) fail(`Invalid metadata: ${file}`);
    return data;
}

function typeOf(dir) {
    return fs.existsSync(path.join(dir, "config.json")) ? "blog" : "folder";
}

function resolveDir(lib, sub = "", containerOnly = false) {
    libraryFor(lib);
    if (typeof sub !== "string") fail("Invalid folder path");
    const parts = sub ? sub.split("/") : [];
    parts.forEach(segment);
    let dir = ROOT;
    for (const part of [lib, ...parts]) {
        if (dir !== ROOT && typeOf(dir) === "blog") fail("Cannot browse beneath a blog");
        dir = path.join(dir, part);
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Not a regular library folder");
    }
    if (containerOnly && typeOf(dir) === "blog") fail("A blog cannot contain library entries");
    return dir;
}

function itemFor(lib, sub, name, dir, root = false) {
    const type = typeOf(dir);
    const config = readMeta(dir, type);
    return {
        key: name,
        name,
        type,
        lib,
        sub,
        root,
        urlPath: [lib, sub, root ? "" : name].filter(Boolean).join("/"),
        displayName: typeof config.name === "string" && config.name.trim() ? config.name.trim() : name,
        goAfter: typeof config.goAfter === "string" ? config.goAfter : "",
        date: config.date || [],
        private: config.private === true || (type === "blog" && config.block === true),
    };
}

function children(lib, sub = "") {
    const library = libraryFor(lib);
    const dir = resolveDir(lib, sub, true);
    const items = fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "media")
        .map(entry => entry.name)
        .sort(naturalCompare)
        .map(name => itemFor(lib, sub, name, path.join(dir, name)));
    return [
        ...orderSiblings(items.filter(item => item.type === "blog"), library.useDates === true),
        ...orderSiblings(items.filter(item => item.type === "folder"), false),
    ];
}

function tree(lib, sub = "") {
    const dir = resolveDir(lib, sub);
    const type = typeOf(dir);
    const current = itemFor(lib, sub, sub.split("/").pop() || lib, dir, true);
    return { type, current, items: type === "blog" ? [] : children(lib, sub) };
}

function walkBlogsForLibrary(library) {
    const out = [];
    function walk(sub) {
        const level = tree(library.path, sub);
        if (level.type === "blog") {
            const item = level.current;
            out.push({ ...item, root: sub === "", name: item.displayName, slugPath: sub ? sub.split("/") : [] });
            return;
        }
        for (const item of level.items) {
            if (item.type === "blog") {
                out.push({
                    ...item,
                    name: item.displayName,
                    slugPath: [sub, item.name].filter(Boolean).join("/").split("/"),
                });
            } else {
                walk([sub, item.name].filter(Boolean).join("/"));
            }
        }
    }
    if (fs.existsSync(path.join(ROOT, library.path))) walk("");
    return out;
}

function metadataFile(dir, item) {
    return path.join(dir, item.name, item.type === "blog" ? "config.json" : "folder.json");
}

function chainWrites(dir, items) {
    return items.flatMap((item, index) => {
        const file = metadataFile(dir, item);
        const data = readMeta(path.join(dir, item.name), item.type);
        const goAfter = index === 0 ? "first_blog" : items[index - 1].name;
        return data.goAfter === goAfter ? [] : [{ file, data: { ...data, goAfter } }];
    });
}

function writeBatch(writes) {
    const originals = writes.map(({ file }) => ({
        file,
        data: fs.existsSync(file) ? fs.readFileSync(file) : null,
    }));
    try {
        for (const { file, data } of writes) writeJsonFileAtomic(file, data);
    } catch (error) {
        const failures = [];
        for (const original of originals.reverse()) {
            try {
                if (original.data === null) fs.rmSync(original.file, { force: true });
                else fs.writeFileSync(original.file, original.data);
            } catch (rollbackError) {
                failures.push(rollbackError.message);
            }
        }
        if (failures.length) error.message += `; rollback failed: ${failures.join("; ")}`;
        throw error;
    } finally {
        statCache.clear();
    }
}

function assertAvailable(dir, name) {
    segment(name);
    if (fs.readdirSync(dir).some(existing => existing.toLowerCase() === name.toLowerCase())) {
        fail("An entry with that name already exists", 409);
    }
}

module.exports = {
    ROOT,
    fail,
    segment,
    libraryFor,
    readMeta,
    typeOf,
    resolveDir,
    children,
    tree,
    walkBlogsForLibrary,
    metadataFile,
    chainWrites,
    writeBatch,
    assertAvailable,
};