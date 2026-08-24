const fs = require("fs");
const path = require("path");
const { STAT_TTL_MS, FOLDER_SUPPORTED } = require("./constants");
const { naturalSort } = require("./utils");

// Tiny TTL-based stat cache to avoid re-stat'ing the same file dozens of times
// during a single burst of requests. Entries expire quickly so filesystem
// changes are picked up almost immediately.
const statCache = new Map();

function cachedStat(fsPath) {
    const now = Date.now();
    const hit = statCache.get(fsPath);
    if (hit && hit.expires > now) return hit.stat;

    let stat;
    try { stat = fs.statSync(fsPath); }
    catch { statCache.set(fsPath, { stat: null, expires: now + STAT_TTL_MS }); return null; }

    statCache.set(fsPath, { stat, expires: now + STAT_TTL_MS });
    return stat;
}

function invalidateStat(fsPath) {
    statCache.delete(fsPath);
}

// Bound cache growth. Simple periodic prune.
function startStatCachePruner() {
    return setInterval(() => {
        const now = Date.now();
        for (const [k, v] of statCache) {
            if (v.expires <= now) statCache.delete(k);
        }
        // Hard cap
        if (statCache.size > 5000) {
            const excess = statCache.size - 5000;
            let i = 0;
            for (const k of statCache.keys()) {
                if (i++ >= excess) break;
                statCache.delete(k);
            }
        }
    }, 10000).unref();
}

function fileExists(filePath) {
    const s = cachedStat(filePath);
    return s ? s.isFile() : false;
}

function dirExists(dirPath) {
    const s = cachedStat(dirPath);
    return s ? s.isDirectory() : false;
}

// ── Directory listing helper (shared) ─────────────────────────────────────────

function listSupportedMedia(folderPath) {
    if (!dirExists(folderPath)) return [];
    return fs.readdirSync(folderPath)
        .filter(f => {
            if (!FOLDER_SUPPORTED.test(f)) return false;
            const s = cachedStat(path.join(folderPath, f));
            return s && s.isFile();
        })
        .sort(naturalSort);
}

module.exports = {
    statCache,
    cachedStat,
    invalidateStat,
    startStatCachePruner,
    fileExists,
    dirExists,
    listSupportedMedia,
};
