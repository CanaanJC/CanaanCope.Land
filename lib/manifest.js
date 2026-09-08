const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");
const { cachedStat, fileExists, dirExists } = require("./fsCache");
const { naturalCompare, normGoAfter, orderSiblings } = require("./sortOrder");

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function folderLabel(folderName, metaName) {
    const name = typeof metaName === "string" ? metaName.trim() : "";
    if (name) return name;
    return String(folderName === undefined || folderName === null ? "" : folderName);
}

function listDirs(dirPath) {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
        .filter(name => {
            if (name.startsWith(".")) return false;
            if (name === "media") return false;
            const s = cachedStat(path.join(dirPath, name));
            return s && s.isDirectory();
        })
        .sort(naturalCompare);
}

function buildNode(dirPath, segments) {
    const slug = segments.length ? segments[segments.length - 1] : "";
    const configPath = path.join(dirPath, "config.json");

    if (fileExists(configPath)) {
        const config = readJsonSafe(configPath) || {};
        return {
            type: "blog",
            slug,
            segments,
            config,
            goAfter: normGoAfter(config.goAfter),
            date: config.date || null,
        };
    }

    const meta = readJsonSafe(path.join(dirPath, "folder.json")) || {};
    const children = listDirs(dirPath).map(name =>
        buildNode(path.join(dirPath, name), [...segments, name])
    );

    return {
        type: "folder",
        slug,
        segments,
        meta,
        goAfter: normGoAfter(meta.goAfter),
        name: folderLabel(slug, meta.name),
        children,
    };
}

function orderChildren(children, useDates) {
    const folders = children.filter(c => c.type === "folder");
    const blogs = children.filter(c => c.type === "blog");

    const orderedFolders = orderSiblings(
        folders.map(f => ({ key: f.slug, goAfter: f.goAfter, node: f })),
        false
    ).map(x => x.node);

    const orderedBlogs = orderSiblings(
        blogs.map(b => ({ key: b.slug, goAfter: b.goAfter, date: b.date, node: b })),
        useDates
    ).map(x => x.node);

    return [...orderedBlogs, ...orderedFolders];
}

function flatten(node, useDates, parents, out) {
    for (const child of orderChildren(node.children || [], useDates)) {
        if (child.type === "blog") {
            const config = child.config || {};
            if (config.private === true) continue;

            out.push({
                segments: child.segments,
                slugPath: [...child.segments],
                slug: child.slug,
                name: config.name || child.slug,
                date: config.date || null,
                description: config.description || "",
                featured: config.featured === true,
                private: false,
                goAfter: normGoAfter(config.goAfter),
                parents: parents.map(p => ({ slug: p.slug, name: p.name, goAfter: p.goAfter })),
            });
        } else {
            flatten(child, useDates, [...parents, child], out);
        }
    }
}

function getLibraryManifest(library) {
    const baseDir = path.join(PUBLIC_DIR, "libraries", library.path);
    if (!dirExists(baseDir)) return [];

    const root = buildNode(baseDir, []);
    if (root.type === "blog") {
        const config = root.config || {};
        if (config.private === true) return [];

        return [{
            segments: [],
            slugPath: [],
            slug: library.path,
            name: config.name || library.path,
            date: config.date || null,
            description: config.description || "",
            featured: config.featured === true,
            private: false,
            goAfter: root.goAfter,
            parents: [],
        }];
    }

    const out = [];
    flatten(root, library.useDates === true, [], out);
    return out;
}

function isBlogDir(dirPath) {
    return fileExists(path.join(dirPath, "config.json"));
}

module.exports = {
    getLibraryManifest,
    folderLabel,
    isBlogDir,
    naturalCompare,
};