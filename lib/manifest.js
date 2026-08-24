const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");
const { naturalSort } = require("./utils");
const { cachedStat, fileExists, dirExists } = require("./fsCache");

// ── Folder-name parsing (title-mode libraries) ────────────────────────────────
//
// A folder named "00-about", "01_Intro", "3 My Section", or even "7Foo" is
// parsed into { num, title }. The leading digits (any amount) become the
// sort key; whatever follows becomes the display title (dash/underscore
// separators normalized to spaces, each word capitalized). Folders with no
// leading number just become { num: 0, title: <formatted whole name> }.

function formatTitle(str) {
    return str
        .replace(/[-_]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function parseFolderName(folderName) {
    const m = folderName.match(/^(\d+)[-_\s]+(.*)$/);
    if (m && m[2]) {
        return { num: parseInt(m[1], 10), title: formatTitle(m[2]) };
    }
    const bare = folderName.match(/^(\d+)(.+)$/);
    if (bare && bare[2]) {
        return { num: parseInt(bare[1], 10), title: formatTitle(bare[2]) };
    }
    return { num: 0, title: formatTitle(folderName) };
}

// ── Generic recursive manifest walker ─────────────────────────────────────────
//
// Walks `library.depth` levels of folders under public/{library.path}.
// Every folder at every level gets its {num, title} parsed (used by
// title-mode/non-date libraries for nav). At the final depth level, a folder
// is a leaf only if it has a config.json; leaves with `block: true` are
// skipped entirely (invisible to manifest + routes, same as before).

function listDirs(dirPath) {
    if (!dirExists(dirPath)) return [];
    return fs.readdirSync(dirPath)
        .filter(name => {
            const s = cachedStat(path.join(dirPath, name));
            return s && s.isDirectory();
        })
        .sort(naturalSort);
}

function walkLevel(dirPath, remainingDepth, parentSegments, out) {
    for (const folderName of listDirs(dirPath)) {
        const folderPath      = path.join(dirPath, folderName);
        const { num, title }  = parseFolderName(folderName);
        const segment          = { slug: folderName, num, title };
        const segments          = [...parentSegments, segment];

        if (remainingDepth === 1) {
            const configPath = path.join(folderPath, "config.json");
            if (!fileExists(configPath)) continue; // not a valid leaf — skip

            let config = {};
            try {
                config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
            } catch {
                config = {};
            }
            if (config.block) continue;

            out.push({
                segments,
                slugPath:    segments.map(s => s.slug),
                slug:        segment.slug, // convenience: last segment (matches old flat-manifest shape)
                name:        config.name        || title,
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
    const baseDir = path.join(PUBLIC_DIR, library.path);
    const out = [];
    walkLevel(baseDir, library.depth, [], out);
    return out;
}

module.exports = {
    parseFolderName,
    getLibraryManifest,
};
