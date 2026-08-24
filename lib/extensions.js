const fs = require("fs");
const path = require("path");

const EXTENSIONS_DIR = path.join(__dirname, "..", "extensions");

const loadedExtensions = [];

function isCandidateEntry(name) {
    return !name.startsWith(".") && !name.startsWith("_");
}

function resolveEntryModule(entryPath) {
    let stat;
    try { stat = fs.statSync(entryPath); }
    catch { return null; }

    if (stat.isDirectory()) {
        const indexPath = path.join(entryPath, "index.js");
        return fs.existsSync(indexPath) ? indexPath : null;
    }
    if (stat.isFile() && entryPath.toLowerCase().endsWith(".js")) {
        return entryPath;
    }
    return null;
}

function buildExtensionContext() {
    const { PUBLIC_DIR } = require("./constants");
    const {
        escape,
        isSafeSegment,
        sanitizePath,
        getMimeType,
        naturalSort,
    } = require("./utils");
    const {
        cachedStat,
        fileExists,
        dirExists,
        listSupportedMedia,
    } = require("./fsCache");
    const { getLibraries, getLibraryByPath, getSiteInfo, getTheme, getWebhooks, getBackupConfig } = require("./siteConfig");
    const { getFaviconUrl } = require("./favicon");

    return {
        PUBLIC_DIR,
        EXTENSIONS_DIR,
        escape,
        isSafeSegment,
        sanitizePath,
        getMimeType,
        naturalSort,
        cachedStat,
        fileExists,
        dirExists,
        listSupportedMedia,
        getLibraries,
        getLibraryByPath,
        getSiteInfo,
        getTheme,
        getWebhooks,
        getBackupConfig,
        getFaviconUrl,
        log: (...args) => console.log("[ext]", ...args),
        logError: (...args) => console.error("[ext]", ...args),
    };
}

function loadExtensions() {
    loadedExtensions.length = 0;

    if (!fs.existsSync(EXTENSIONS_DIR)) {
        console.log("[extensions] no extensions/ directory found — skipping");
        return loadedExtensions;
    }

    const context = buildExtensionContext();
    const entries = fs.readdirSync(EXTENSIONS_DIR).filter(isCandidateEntry);

    for (const entryName of entries) {
        const entryPath  = path.join(EXTENSIONS_DIR, entryName);
        const modulePath = resolveEntryModule(entryPath);
        if (!modulePath) continue;

        let ext;
        try {
            delete require.cache[require.resolve(modulePath)];
            ext = require(modulePath);
        } catch (e) {
            console.error(`[extensions] failed to load "${entryName}": ${e.message}`);
            continue;
        }

        if (!ext || typeof ext !== "object") {
            console.error(`[extensions] "${entryName}" does not export an object — skipping`);
            continue;
        }

        if (ext.enabled === false) {
            console.log(`[extensions] "${entryName}" disabled (enabled: false) — skipping`);
            continue;
        }

        const name = ext.name || entryName;

        if (typeof ext.init === "function") {
            try {
                ext.init(context);
            } catch (e) {
                console.error(`[extensions] "${name}" init() threw: ${e.message}`);
            }
        }

        loadedExtensions.push({ name, dirName: entryName, entryPath, module: ext, context });
        console.log(`[extensions] loaded: ${name}`);
    }

    if (loadedExtensions.length === 0) {
        console.log("[extensions] none loaded");
    }

    return loadedExtensions;
}

function runExtensions(req, res, safePath, stdHeaders) {
    const method = req.method || "GET";

    for (const { name, module: ext, context } of loadedExtensions) {
        if (Array.isArray(ext.routes)) {
            for (const route of ext.routes) {
                if (!route || typeof route.handler !== "function") continue;
                if (route.method && route.method.toUpperCase() !== method) continue;

                const match = safePath.match(route.pattern);
                if (!match) continue;

                try {
                    const handled = route.handler(req, res, match, { ...context, stdHeaders });
                    if (handled !== false) return true;
                } catch (e) {
                    console.error(`[extensions] "${name}" route handler threw: ${e.message}`);
                    return false;
                }
            }
        }

        if (typeof ext.handleRequest === "function") {
            try {
                const handled = ext.handleRequest(req, res, safePath, stdHeaders, context);
                if (handled) return true;
            } catch (e) {
                console.error(`[extensions] "${name}" handleRequest() threw: ${e.message}`);
            }
        }
    }

    return false;
}

module.exports = {
    EXTENSIONS_DIR,
    loadExtensions,
    runExtensions,
};
