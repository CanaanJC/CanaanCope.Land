const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DOWNLOAD_TMP_DIR } = require("./constants");
const { sendJson } = require("./shared");
const { getArchiveConfig, getHostingConfig, getSiteInfo } = require("../siteConfig");
const { getAllManifestEntries, findManifestEntry } = require("../archiveManager");

function pad(n) {
    return String(n).padStart(2, "0");
}

function formatDownloadDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "unknown-date";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function sanitizeDownloadFilename(name) {
    return String(name).replace(/["\\\r\n]/g, "");
}

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

async function handleArchiveRoutes(req, res, safePath, method) {
    if (safePath === "/api/archive-list" && method === "GET") {
        const archiveCfg = getArchiveConfig();
        const hosting    = getHostingConfig();
        const entries    = getAllManifestEntries().map(e => ({
            uuid: e.uuid,
            tag: e.tag || null,
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

    return false;
}

module.exports = { handleArchiveRoutes };
