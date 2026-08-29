const fs = require("fs");
const path = require("path");
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

// Resolves a user-supplied relative path (e.g. "config/master.json") to an
// absolute path, guaranteed to stay inside PROJECT_ROOT and end in ".json".
// Returns null if the path is missing, absolute, escapes the project root,
// or isn't a .json file — used by the generic /api/file editor endpoint so
// arbitrary filesystem reads/writes are never possible from the client.
function resolveSafeJsonPath(relPath) {
    if (typeof relPath !== "string" || relPath.length === 0) return null;
    if (path.isAbsolute(relPath)) return null;
    if (!relPath.toLowerCase().endsWith(".json")) return null;

    const resolved = path.resolve(PROJECT_ROOT, relPath);
    const rootWithSep = PROJECT_ROOT.endsWith(path.sep) ? PROJECT_ROOT : PROJECT_ROOT + path.sep;
    if (resolved !== PROJECT_ROOT && !resolved.startsWith(rootWithSep)) return null;

    return resolved;
}

// Recursively sums the size (in bytes) of every file under `targetPath`,
// skipping any entry whose name starts with ".tmp" (e.g. ADMIN/.tmp-downloads
// — scratch space that shouldn't count toward the reported size). Symlinks
// are not followed (lstat) to avoid loops/double-counting.
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
        if (TMP_DIR_RE.test(entry)) continue; // skip .tmp* dirs/files
        total += getDirSizeSync(path.join(targetPath, entry));
    }
    return total;
}

// Cached — see SERVER_SIZE_CACHE_MS comment above. Sums only the entries
// backup.js actually copies (BACKUP_COPY_ENTRIES, imported from lib/backup.js)
// so this badge always exactly matches what a real backup would contain —
// no .git, no .vscode, no README.md, etc., and it can never silently drift
// out of sync with backup.js since it's the same source list.
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

    // ── Server size — total size (bytes) of exactly the entries backup.js
    // copies into a backup (BACKUP_COPY_ENTRIES), for the header badge.
    // Cached briefly since it's a recursive filesystem walk.
    if (safePath === "/api/server-size" && method === "GET") {
        try {
            const bytes = getServerSizeBytes();
            sendJson(res, 200, { bytes });
        } catch (e) {
            sendJson(res, 500, { error: `Failed to compute server size: ${e.message}` });
        }
        return true;
    }

    // ── Update checker — cached status only (GET), never triggers a real
    // GitHub API call on its own. The server itself checks on boot and
    // once an hour (see lib/updateChecker.js); this just reports whatever
    // that last found. Reading this on every admin page load/refresh is
    // free — no network call happens here.
    if (safePath === "/api/update-status" && method === "GET") {
        sendJson(res, 200, getUpdateStatus());
        return true;
    }

    // ── Update checker — manual re-check, triggered only by the admin
    // panel's refresh button. This is the ONLY client-triggerable path
    // that actually hits the GitHub API outside of boot/the hourly timer.
    if (safePath === "/api/update-check" && method === "POST") {
        try {
            const status = await performUpdateCheck();
            sendJson(res, 200, status);
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

    // ── Generic JSON-file editor endpoint ─────────────────────────────────
    // Used by any "target"-based element (config.json's "target" field, e.g.
    // the "master.json" element) AND by the Blog Editor's config.json mode
    // (target = "public/<library>/<slug...>/config.json"). ?path= is
    // relative to the project root (node.js's own directory) and must
    // resolve to a .json file inside it.
    if (safePath === "/api/file" && method === "GET") {
        const query    = new URL(req.url, "http://internal").searchParams;
        const relPath  = query.get("path");
        const filePath = resolveSafeJsonPath(relPath);

        if (!filePath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\" query parameter" });
            return true;
        }

        try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            sendJson(res, 200, data);
        } catch (e) {
            sendJson(res, 500, { error: `Failed to read "${relPath}": ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/file" && method === "PUT") {
        const query    = new URL(req.url, "http://internal").searchParams;
        const relPath  = query.get("path");
        const filePath = resolveSafeJsonPath(relPath);

        if (!filePath) {
            sendJson(res, 400, { error: "Invalid or missing \"path\" query parameter" });
            return true;
        }

        try {
            const data    = await readJsonBody(req);
            // Self-heals known-numeric fields (fontSize/depth/collapsedWidth/
            // expandedWidth/iconSize) back to real numbers even if the
            // frontend serialized them as strings — see coerceNumericStrings
            // in lib/siteConfig.js for the full rationale.
            const coerced = coerceNumericStrings(data);
            // Atomic write (temp file + rename) — eliminates the window
            // where a partially-written/truncated file could ever be
            // observed on disk, which is what caused the intermittent
            // trailing-garbage/NUL-byte corruption in master.json.
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
