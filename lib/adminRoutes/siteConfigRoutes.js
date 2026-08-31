const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("../constants");
const { PROJECT_ROOT, TMP_DIR_RE, SERVER_SIZE_CACHE_MS } = require("./constants");
const { sendJson, readJsonBody, writeJsonFileAtomic } = require("./shared");
const {
    getFullConfig,
    saveMasterConfig,
    getSiteInfo,
    coerceNumericStrings,
} = require("../siteConfig");
const { invalidateStat } = require("../fsCache");
const { COPY_ENTRIES: BACKUP_COPY_ENTRIES } = require("../backup");
const { getStatus: getUpdateStatus, performCheck: performUpdateCheck } = require("../updateChecker");

function resolveTarget(relPath) {
    if (typeof relPath !== "string" || relPath.length === 0) return null;
    if (path.isAbsolute(relPath)) return null;
    if (!relPath.toLowerCase().endsWith(".json")) return null;

    const normalized = relPath.replace(/\\/g, "/").replace(/\/{2,}/g, "/");

    let resolved;
    let root;

    if (normalized === "public" || normalized.startsWith("public/")) {
        const rest = normalized.slice("public".length).replace(/^\//, "");
        resolved = path.resolve(PUBLIC_DIR, rest);
        root = PUBLIC_DIR;
    } else {
        resolved = path.resolve(PROJECT_ROOT, normalized);
        root = PROJECT_ROOT;
    }

    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) return null;

    return resolved;
}

function insertLibrariesSegment(relPath) {
    const normalized = relPath.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (!normalized.startsWith("public/")) return null;

    const rest = normalized.slice("public/".length);
    if (rest.startsWith("libraries/")) return null; // already correct

    return `public/libraries/${rest}`;
}

function resolveSafeJsonPath(relPath, mustExist = false) {
    const primary = resolveTarget(relPath);
    if (!primary) return null;
    if (!mustExist) return primary;
    if (fs.existsSync(primary)) return primary;

    const healed = insertLibrariesSegment(relPath);
    if (!healed) return primary;

    const alt = resolveTarget(healed);
    if (alt && fs.existsSync(alt)) {
        console.warn(
            `[admin] /api/file: "${relPath}" not found — served "${healed}" instead. ` +
            `This means a STALE CACHED copy of ADMIN/library-explorer/js/config-editor.js ` +
            `is still running in the browser; hard-reload the Library Explorer (Ctrl/Cmd+Shift+R).`
        );
        return alt;
    }

    return primary; // let the caller 404 with the original path in the message
}

function getDirSizeSync(targetPath) {
    let total = 0;
    let stat;
    try { stat = fs.lstatSync(targetPath); } catch { return 0; }

    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;

    let entries;
    try { entries = fs.readdirSync(targetPath); } catch { return 0; }

    for (const entry of entries) {
        if (TMP_DIR_RE.test(entry)) continue;
        total += getDirSizeSync(path.join(targetPath, entry));
    }
    return total;
}

let _serverSizeCache = { bytes: 0, expires: 0 };

function getServerSizeBytes() {
    const now = Date.now();
    if (_serverSizeCache.expires > now) return _serverSizeCache.bytes;

    let bytes = 0;
    for (const entry of BACKUP_COPY_ENTRIES) {
        bytes += getDirSizeSync(path.join(PROJECT_ROOT, entry));
    }

    _serverSizeCache = { bytes, expires: now + SERVER_SIZE_CACHE_MS };
    return bytes;
}

async function handleSiteConfigRoutes(req, res, safePath, method) {
    if (safePath === "/api/site-info" && method === "GET") {
        sendJson(res, 200, getSiteInfo());
        return true;
    }

    if (safePath === "/api/server-size" && method === "GET") {
        try {
            sendJson(res, 200, { bytes: getServerSizeBytes() });
        } catch (e) {
            sendJson(res, 500, { error: `Failed to compute server size: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/update-status" && method === "GET") {
        sendJson(res, 200, getUpdateStatus());
        return true;
    }

    if (safePath === "/api/update-check" && method === "POST") {
        try {
            sendJson(res, 200, await performUpdateCheck());
        } catch (e) {
            sendJson(res, 500, { error: `Update check failed: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/config" && method === "GET") {
        sendJson(res, 200, getFullConfig());
        return true;
    }

    if (safePath === "/api/config" && method === "PUT") {
        try {
            const data = await readJsonBody(req);
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                sendJson(res, 400, { error: "Config must be a JSON object" });
                return true;
            }
            const ok = saveMasterConfig(data);
            sendJson(res, ok ? 200 : 500, ok ? { ok: true } : { error: "Failed to write config" });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/file" && method === "GET") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const relPath = query.get("path");
        const filePath = resolveSafeJsonPath(relPath, true);

        if (!filePath) {
            sendJson(res, 400, { error: `Invalid or missing "path" query parameter (got "${relPath}")` });
            return true;
        }

        if (!fs.existsSync(filePath)) {
            console.error(`[admin] /api/file: no such file — "${relPath}" → ${filePath}`);
            sendJson(res, 404, { error: `File not found: "${relPath}" (looked in ${filePath})` });
            return true;
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

            if (data === null || typeof data !== "object") {
                sendJson(res, 500, { error: `"${relPath}" does not contain a JSON object or array` });
                return true;
            }

            sendJson(res, 200, data);
        } catch (e) {
            console.error(`[admin] /api/file: failed to read ${filePath}: ${e.message}`);
            sendJson(res, 500, { error: `Failed to read "${relPath}": ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/file" && method === "PUT") {
        const query   = new URL(req.url, "http://internal").searchParams;
        const relPath = query.get("path");

        const filePath = resolveSafeJsonPath(relPath, true);

        if (!filePath) {
            sendJson(res, 400, { error: `Invalid or missing "path" query parameter (got "${relPath}")` });
            return true;
        }

        try {
            const data    = await readJsonBody(req);
            const coerced = coerceNumericStrings(data);
            writeJsonFileAtomic(filePath, coerced);
            invalidateStat(filePath);
            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleSiteConfigRoutes, resolveSafeJsonPath, getServerSizeBytes, getDirSizeSync };
