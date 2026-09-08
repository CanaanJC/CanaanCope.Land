const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");
const { getLibraries } = require("./siteConfig");

const LIBRARIES_ROOT = path.join(PUBLIC_DIR, "libraries");

const BLOG_FIELDS = {
    name: (slug) => slug,
    date: () => [],
    description: () => "",
    featured: () => false,
    goAfter: () => "",
    private: () => false,
};

const REMOVED_BLOG_FIELDS = ["block"];

const FOLDER_FIELDS = {
    name: () => "",
    goAfter: () => "",
};

let created = 0;
let patched = 0;

function logBC(...args) {
    console.log("[blog-config]", ...args);
}

function readJsonSafe(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return null;
    }
}

function writeJsonSafe(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
        fs.writeFileSync(tmp, JSON.stringify(data, null, 4));
        fs.renameSync(tmp, filePath);
        return true;
    } catch (e) {
        logBC(`failed to write ${filePath}: ${e.message}`);
        return false;
    }
}

function normalizeBlog(dirPath, slug) {
    const configPath = path.join(dirPath, "config.json");
    const config = readJsonSafe(configPath);
    if (!config || typeof config !== "object" || Array.isArray(config)) return;

    let changed = false;

    for (const key of REMOVED_BLOG_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(config, key)) {
            if (key === "block" && config[key] === true && config.private !== true) {
                config.private = true;
            }
            delete config[key];
            changed = true;
        }
    }

    for (const [key, factory] of Object.entries(BLOG_FIELDS)) {
        if (!Object.prototype.hasOwnProperty.call(config, key)) {
            config[key] = factory(slug);
            changed = true;
        }
    }

    if (changed && writeJsonSafe(configPath, config)) {
        patched++;
    }
}

function normalizeFolder(dirPath) {
    const folderPath = path.join(dirPath, "folder.json");
    const existing = readJsonSafe(folderPath);

    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        const fresh = {};
        for (const [key, factory] of Object.entries(FOLDER_FIELDS)) fresh[key] = factory();
        if (writeJsonSafe(folderPath, fresh)) created++;
        return;
    }

    let changed = false;
    for (const [key, factory] of Object.entries(FOLDER_FIELDS)) {
        if (!Object.prototype.hasOwnProperty.call(existing, key)) {
            existing[key] = factory();
            changed = true;
        }
    }
    if (changed && writeJsonSafe(folderPath, existing)) patched++;
}

function listDirs(dirPath) {
    try {
        return fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "media")
            .map(e => e.name);
    } catch {
        return [];
    }
}

function walk(dirPath, slug, isLibraryRoot) {
    if (fs.existsSync(path.join(dirPath, "config.json"))) {
        normalizeBlog(dirPath, slug);
        return;
    }

    if (!isLibraryRoot) normalizeFolder(dirPath);
    else normalizeFolder(dirPath);

    for (const name of listDirs(dirPath)) {
        walk(path.join(dirPath, name), name, false);
    }
}

function ensureBlogStructure() {
    created = 0;
    patched = 0;

    if (!fs.existsSync(LIBRARIES_ROOT)) {
        logBC("no public/libraries directory — nothing to normalize");
        return;
    }

    for (const library of getLibraries()) {
        const root = path.join(LIBRARIES_ROOT, library.path);
        if (!fs.existsSync(root)) continue;
        walk(root, library.path, true);
    }

    logBC(`normalized library tree — ${created} folder.json created, ${patched} json file(s) back-filled`);
}

module.exports = { ensureBlogStructure };