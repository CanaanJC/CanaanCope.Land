const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ADMIN_DIR, PUBLIC_DIR, CMPSD_DIRNAME } = require("./constants");
const {
    getFullConfig,
    saveMasterConfig,
    getSiteInfo,
    getLibrariesRaw,
    saveLibraries,
    getArchiveConfig,
    getHostingConfig,
} = require("./siteConfig");
const { invalidateStat } = require("./fsCache");
const { getAllManifestEntries, findManifestEntry } = require("./archiveManager");
const { COPY_ENTRIES: BACKUP_COPY_ENTRIES } = require("./backup");

const ADMIN_LAYOUT_PATH = path.join(ADMIN_DIR, "config", "master.json");
const LOGO_PATH         = path.join(PUBLIC_DIR, "media", "logo.png");
const LOGO_VARIANT_PATH = path.join(PUBLIC_DIR, "media", CMPSD_DIRNAME, "logo.avif");
const MAX_UPLOAD_BYTES  = 20 * 1024 * 1024;

// Project root — the directory node.js itself lives in. Generic JSON-file
// editors (e.g. the "master.json" element) target files by a path relative
// to this, e.g. "config/master.json". Also the root the server-size
// indicator measures (mirrors what backup.js actually archives).
const PROJECT_ROOT = path.join(ADMIN_DIR, "..");

// Scratch folder for archive-download archives. Only ever holds at most one
// file at a time in practice — each new download request wipes whatever's
// left over here from the previous one before building the next.
const DOWNLOAD_TMP_DIR = path.join(ADMIN_DIR, ".tmp-downloads");

// ── Asset upload targets (library icons / sidebar link icons) ────────────────
// These folders don't exist in a fresh checkout of the repo (media/ is
// gitignored so the public repo copy never ships anyone's actual media).
// Both are created on-demand by the upload endpoint below, the first time
// anything is ever uploaded through the admin panel.
const LIBRARIES_MEDIA_DIR = path.join(PUBLIC_DIR, "media", "libraries");
const SIDEBAR_MEDIA_DIR   = path.join(PUBLIC_DIR, "media", "sidebar");

const UPLOAD_TARGETS = {
    library: { dir: LIBRARIES_MEDIA_DIR, relPrefix: "media/libraries" },
    sidebar: { dir: SIDEBAR_MEDIA_DIR,   relPrefix: "media/sidebar" },
};

// Any path segment starting with ".tmp" is excluded from both backups (see
// lib/backup.js) and the server-size scan below — scratch space that
// shouldn't count toward "how big is this thing" or ever get archived.
const TMP_DIR_RE = /^\.tmp/i;

// Brief cache for the server-size scan — a full recursive stat walk of the
// whole project (potentially including node_modules) on every single
// header paint would be wasteful. 30s is plenty fresh for a "how big is
// this thing" badge.
const SERVER_SIZE_CACHE_MS = 30 * 1000;
let _serverSizeCache = { bytes: 0, expires: 0 };

function sendJson(res, status, body) {
    const json = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(json),
        "Cache-Control": "no-store",
    });
    res.end(json);
}

function readBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        req.on("data", (chunk) => {
            total += chunk.length;
            if (total > maxBytes) {
                reject(new Error("Payload too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function readJsonBody(req) {
    const buf = await readBody(req, 5 * 1024 * 1024);
    return JSON.parse(buf.toString("utf-8"));
}

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

// Sanitizes a user-supplied name (library name / sidebar link text) down to
// a safe filename stem: lowercased, non-alphanumeric runs collapsed to a
// single dash, leading/trailing dashes trimmed. Returns "" if nothing usable
// remains (caller treats that as an error — never writes a blank filename).
function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function pad(n) {
    return String(n).padStart(2, "0");
}

// "2026-08-23_14-30" — filesystem/header-safe, matches the download
// filename's date portion.
function formatDownloadDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "unknown-date";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

// Strips characters that are unsafe inside a Content-Disposition filename
// (quotes/backslashes/control chars) — spaces and dashes are fine and kept
// so "siteName - date.zip" reads naturally.
function sanitizeDownloadFilename(name) {
    return String(name).replace(/["\\\r\n]/g, "");
}

// Deletes every file currently sitting in the scratch download folder.
// Called at the start of every new archive-download request, per spec:
// "once the next download is triggered it first checks to see if any zips
// exist, delete it and start the download for the next one."
function clearDownloadTmpDir() {
    try {
        fs.mkdirSync(DOWNLOAD_TMP_DIR, { recursive: true });
        for (const name of fs.readdirSync(DOWNLOAD_TMP_DIR)) {
            try { fs.unlinkSync(path.join(DOWNLOAD_TMP_DIR, name)); } catch {}
        }
    } catch (e) {
        console.error(`[admin] failed to clear download tmp dir: ${e.message}`);
    }
}

function runProcess(cmd, args, opts) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { ...opts, stdio: ["ignore", "ignore", "pipe"] });

        let stderr = "";
        if (proc.stderr) {
            proc.stderr.on("data", (d) => {
                stderr += d.toString();
                if (stderr.length > 4000) stderr = stderr.slice(-4000);
            });
        }

        proc.on("error", (err) => reject(err));

        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited ${code}${stderr ? ` — ${stderr.trim().split("\n").slice(-3).join(" | ")}` : ""}`));
        });
    });
}

// Builds an archive of `folderName` (inside `parentDir`) into the scratch
// folder. Tries `zip` first (real .zip); if `zip` isn't installed (ENOENT),
// transparently falls back to `tar` + gzip (.tar.gz — tar is virtually
// always present on Linux, unlike zip). Returns { filePath, filename }.
async function buildDownloadArchive(parentDir, folderName, baseFilename) {
    const zipPath = path.join(DOWNLOAD_TMP_DIR, `${baseFilename}.zip`);
    try {
        await runProcess("zip", ["-r", "-X", zipPath, folderName], { cwd: parentDir });
        return { filePath: zipPath, filename: `${baseFilename}.zip`, contentType: "application/zip" };
    } catch (e) {
        if (e.code !== "ENOENT") throw e; // zip exists but failed for another reason — surface it
        console.error("[admin] \"zip\" not found on PATH — falling back to tar.gz. Install zip (e.g. `sudo apt install zip`) to get real .zip downloads.");
    }

    const tgzPath = path.join(DOWNLOAD_TMP_DIR, `${baseFilename}.tar.gz`);
    await runProcess("tar", ["-czf", tgzPath, "-C", parentDir, folderName], {});
    return { filePath: tgzPath, filename: `${baseFilename}.tar.gz`, contentType: "application/gzip" };
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

async function handleAdminRoutes(req, res, safePath) {
    const method = req.method || "GET";

    if (safePath === "/api/layout" && method === "GET") {
        try {
            const layout = JSON.parse(fs.readFileSync(ADMIN_LAYOUT_PATH, "utf-8"));
            sendJson(res, 200, layout);
        } catch (e) {
            sendJson(res, 500, { error: `Failed to read admin layout: ${e.message}` });
        }
        return true;
    }

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
    // the "master.json" element). ?path= is relative to the project root
    // (node.js's own directory) and must resolve to a .json file inside it.
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
            const data = await readJsonBody(req);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
            invalidateStat(filePath);
            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    if (safePath === "/api/libraries" && method === "GET") {
        sendJson(res, 200, getLibrariesRaw());
        return true;
    }

    if (safePath === "/api/libraries" && method === "PUT") {
        try {
            const data = await readJsonBody(req);
            if (!Array.isArray(data)) {
                sendJson(res, 400, { error: "Libraries must be a JSON array" });
                return true;
            }
            const ok = saveLibraries(data);
            sendJson(res, ok ? 200 : 500, ok ? { ok: true } : { error: "Failed to write libraries.json" });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    // ── Archive listing (read-only) — settings + every past backup's link
    // info. publicPort is included so the frontend can build links to the
    // main site's port from this admin page's own host.
    if (safePath === "/api/archive-list" && method === "GET") {
        const archiveCfg = getArchiveConfig();
        const hosting    = getHostingConfig();
        const entries    = getAllManifestEntries().map(e => ({
            uuid: e.uuid,
            timestamp: e.timestamp,
            sizeBytes: e.sizeBytes,
        }));
        sendJson(res, 200, {
            settings: {
                maxConcurrentInstances: archiveCfg.maxConcurrentInstances,
                idleTimeoutMinutes: archiveCfg.idleTimeoutMinutes,
                maxRuntimeMinutes: archiveCfg.maxRuntimeMinutes,
            },
            publicPort: hosting.port,
            entries,
        });
        return true;
    }

    // ── Archive download — builds a real archive file on disk (browsers can
    // only download actual files) into a scratch folder, then streams it
    // back named "<siteName> - <date>.<ext>". Prefers a real .zip; falls
    // back to .tar.gz automatically if `zip` isn't installed on this host.
    // Every new download request first wipes whatever archive(s) are left
    // over from a previous download before building the next one, so the
    // scratch folder never accumulates.
    const downloadMatch = safePath.match(/^\/api\/archive-download\/([0-9a-fA-F-]{36})$/);
    if (downloadMatch && method === "GET") {
        const uuid  = downloadMatch[1];
        const entry = findManifestEntry(uuid);

        if (!entry) {
            sendJson(res, 404, { error: "Backup not found" });
            return true;
        }
        if (!fs.existsSync(entry.folderPath)) {
            sendJson(res, 404, { error: "Backup folder missing on disk" });
            return true;
        }

        // Clear out any archive(s) left over from a previous download
        // before starting this one.
        clearDownloadTmpDir();

        const { siteName } = getSiteInfo();
        const dateStr      = formatDownloadDate(entry.timestamp);
        const baseFilename = sanitizeDownloadFilename(`${siteName || "site"} - ${dateStr}`);

        const parentDir  = path.dirname(entry.folderPath);
        const folderName = path.basename(entry.folderPath);

        let built;
        try {
            built = await buildDownloadArchive(parentDir, folderName, baseFilename);
        } catch (e) {
            console.error(`[admin] archive build failed: ${e.message}`);
            sendJson(res, 500, { error: `Failed to build archive: ${e.message}` });
            return true;
        }

        let stat;
        try {
            stat = fs.statSync(built.filePath);
        } catch (e) {
            sendJson(res, 500, { error: `Archive vanished before sending: ${e.message}` });
            return true;
        }

        res.writeHead(200, {
            "Content-Type": built.contentType,
            "Content-Length": stat.size,
            "Content-Disposition": `attachment; filename="${built.filename}"`,
            "Cache-Control": "no-store",
        });

        const stream = fs.createReadStream(built.filePath);
        stream.on("error", () => { try { res.destroy(); } catch {} });
        req.on("close", () => { stream.destroy(); });
        stream.pipe(res);

        return true;
    }

    if (safePath === "/api/logo" && method === "POST") {
        try {
            const buf = await readBody(req, MAX_UPLOAD_BYTES);
            if (buf.length === 0) {
                sendJson(res, 400, { error: "Empty upload" });
                return true;
            }
            fs.mkdirSync(path.dirname(LOGO_PATH), { recursive: true });
            fs.writeFileSync(LOGO_PATH, buf);
            invalidateStat(LOGO_PATH);

            try {
                fs.unlinkSync(LOGO_VARIANT_PATH);
                invalidateStat(LOGO_VARIANT_PATH);
            } catch {}

            sendJson(res, 200, { ok: true });
        } catch (e) {
            sendJson(res, 500, { error: `Upload failed: ${e.message}` });
        }
        return true;
    }

    // ── Generic asset upload endpoint — library icons / sidebar link icons ──
    //
    // POST /api/upload/library?name=<libraryName>[&overwrite=true]
    // POST /api/upload/sidebar?name=<linkText>[&overwrite=true]
    //
    // Body is the raw PNG bytes. Writes to:
    //   public/media/libraries/<sanitized-name>.png
    //   public/media/sidebar/<sanitized-name>.png
    // creating the target directory if it doesn't exist yet (it won't, on a
    // fresh checkout of the repo, since media/ is gitignored).
    //
    // If the target file already exists and ?overwrite=true was NOT passed,
    // responds 409 { exists: true } instead of writing — the frontend is
    // expected to show its own confirm dialog (matching the existing
    // delete-confirm UX) and retry the same request with ?overwrite=true.
    const uploadMatch = safePath.match(/^\/api\/upload\/(library|sidebar)$/);
    if (uploadMatch && method === "POST") {
        const kind   = uploadMatch[1];
        const target = UPLOAD_TARGETS[kind];

        const query      = new URL(req.url, "http://internal").searchParams;
        const rawName    = query.get("name");
        const overwrite  = query.get("overwrite") === "true";
        const sanitized  = sanitizeAssetName(rawName);

        if (!sanitized) {
            sendJson(res, 400, { error: "Missing or invalid \"name\" query parameter" });
            return true;
        }

        const destPath = path.join(target.dir, `${sanitized}.png`);
        const alreadyExists = fs.existsSync(destPath);

        if (alreadyExists && !overwrite) {
            sendJson(res, 409, { exists: true });
            return true;
        }

        try {
            const buf = await readBody(req, MAX_UPLOAD_BYTES);
            if (buf.length === 0) {
                sendJson(res, 400, { error: "Empty upload" });
                return true;
            }
            fs.mkdirSync(target.dir, { recursive: true });
            fs.writeFileSync(destPath, buf);
            invalidateStat(destPath);

            sendJson(res, 200, { ok: true, path: `${target.relPrefix}/${sanitized}.png` });
        } catch (e) {
            sendJson(res, 500, { error: `Upload failed: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleAdminRoutes };
