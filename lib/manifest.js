const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");
const { cachedStat, fileExists, dirExists } = require("./fsCache");

function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function splitFolderName(folderName) {
    const raw = folderName === undefined || folderName === null ? "" : String(folderName);
    const idx = raw.indexOf("_");
    if (idx === -1) return { prefix: raw, label: raw, raw };
    return { prefix: raw.slice(0, idx), label: raw.slice(idx + 1), raw };
}

function folderLabel(folderName) {
    return splitFolderName(folderName).label;
}

function compareFolderNames(a, b) {
    const A = splitFolderName(a);
    const B = splitFolderName(b);
    let c = naturalCompare(A.prefix, B.prefix);
    if (c !== 0) return c;
    c = naturalCompare(A.label, B.label);
    if (c !== 0) return c;
    return naturalCompare(A.raw, B.raw);
}

function listDirs(dirPath) {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
        .filter(name => {
            const s = cachedStat(path.join(dirPath, name));
            return s && s.isDirectory();
        })
        .sort(compareFolderNames);
}

function walkLevel(dirPath, remainingDepth, parentSegments, out) {
    for (const folderName of listDirs(dirPath)) {
        const folderPath = path.join(dirPath, folderName);
        const segments = [...parentSegments, folderName];

        if (remainingDepth === 1) {
            const configPath = path.join(folderPath, "config.json");
            if (!fileExists(configPath)) continue;

            let config = {};
            try {
                config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            } catch {
                config = {};
            }
            if (config.block) continue;

            out.push({
                segments,
                slugPath:    [...segments],
                slug:        folderName,
                name:        config.name        || folderLabel(folderName),
                date:        config.date        || null,
                description: config.description || "",
                featured:    config.featured    || false,
            });
        } else {
            walkLevel(folderPath, remainingDepth - 1, segments, out);
        }
    }
}

function getLibraryManifest(library) {
    const baseDir = path.join(PUBLIC_DIR, "libraries", library.path);
    const out = [];
    walkLevel(baseDir, library.depth, [], out);
    return out;
}

module.exports = {
    getLibraryManifest,
    splitFolderName,
    folderLabel,
    compareFolderNames,
};
