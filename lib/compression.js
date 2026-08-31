const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const {
    CMPSD_DIRNAME,
    COMPRESS_CONCURRENCY,
    AVIF_CRF,
    MP4_CRF,
    PUBLIC_DIR,
} = require("./constants");
const { relPub, fmtBytes } = require("./utils");
const { invalidateStat } = require("./fsCache");

function logC(...args) {
    console.log("[compress]", ...args);
}

function isInsideCmpsd(p) {
    return p.split(path.sep).includes(CMPSD_DIRNAME);
}

function getVariantInfo(fsPath) {
    const ext  = path.extname(fsPath).toLowerCase();
    const dir  = path.dirname(fsPath);
    const base = path.basename(fsPath, ext);

    if (ext === ".png") {
        return { variantPath: path.join(dir, CMPSD_DIRNAME, base + ".avif"), variantExt: ".avif", kind: "png" };
    }
    if (ext === ".gif") {
        return { variantPath: path.join(dir, CMPSD_DIRNAME, base + ".mp4"), variantExt: ".mp4", kind: "gif" };
    }
    if (ext === ".mp4") {
        return { variantPath: path.join(dir, CMPSD_DIRNAME, base + ".mp4"), variantExt: ".mp4", kind: "mp4" };
    }
    return null;
}

const inProgress = new Set(); // variantPaths currently queued or building
let   activeJobs = 0;
const jobQueue   = [];

function pumpQueue() {
    while (activeJobs < COMPRESS_CONCURRENCY && jobQueue.length > 0) {
        const job = jobQueue.shift();
        activeJobs++;
        job().finally(() => { activeJobs--; pumpQueue(); });
    }
}

function enqueueCompression(job) {
    jobQueue.push(job);
    pumpQueue();
}

function cleanupTmp(p) {
    try { fs.unlinkSync(p); } catch {}
}

function buildVariant(originPath, info) {
    return new Promise((resolve) => {
        const outDir = path.dirname(info.variantPath);
        try {
            fs.mkdirSync(outDir, { recursive: true });
        } catch (e) {
            logC(`error: mkdir failed for ${relPub(outDir)}: ${e.message}`);
            resolve();
            return;
        }

        const tmpPath = `${info.variantPath}.tmp-${process.pid}-${Date.now()}${info.variantExt}`;

        let args;
        if (info.kind === "png") {
            args = [
                "-y", "-i", originPath,
                "-c:v", "libaom-av1",
                "-still-picture", "1",
                "-crf", String(AVIF_CRF),
                "-b:v", "0",
                "-cpu-used", "6",
                "-f", "avif",
                tmpPath,
            ];
        } else if (info.kind === "gif") {
            args = [
                "-y", "-i", originPath,
                "-movflags", "+faststart",
                "-pix_fmt", "yuv420p",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-an",
                tmpPath,
            ];
        } else {
            args = [
                "-y", "-i", originPath,
                "-c:v", "libx264",
                "-crf", String(MP4_CRF),
                "-preset", "medium",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                tmpPath,
            ];
        }

        const rel     = relPub(originPath);
        const started = Date.now();
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

        let stderr = "";
        if (ff.stderr) {
            ff.stderr.on("data", (d) => {
                stderr += d.toString();
                if (stderr.length > 8000) stderr = stderr.slice(-8000);
            });
        }

        ff.on("error", (err) => {
            const hint = err.code === "ENOENT" ? " (ffmpeg not found on PATH?)" : "";
            logC(`error: spawn failed for ${rel}: ${err.message}${hint}`);
            cleanupTmp(tmpPath);
            resolve();
        });

        ff.on("close", (code) => {
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            if (code === 0) {
                try {
                    const s = fs.statSync(tmpPath);
                    if (s.size > 0) {
                        fs.renameSync(tmpPath, info.variantPath);
                        let origSize = 0;
                        try { origSize = fs.statSync(originPath).size; } catch {}
                        const pct = origSize ? (100 * (1 - s.size / origSize)).toFixed(1) : "?";
                        logC(`done ${rel}  ${fmtBytes(origSize)} → ${fmtBytes(s.size)} (${pct}% smaller, ${secs}s)`);
                    } else {
                        logC(`error: empty output for ${rel} (${secs}s)`);
                        cleanupTmp(tmpPath);
                    }
                } catch (e) {
                    logC(`error: finalize failed for ${rel}: ${e.message}`);
                    cleanupTmp(tmpPath);
                }
            } else {
                logC(`error: ffmpeg exited ${code} for ${rel} (${secs}s)`);
                const tail = stderr.trim().split("\n").slice(-4).join(" | ");
                if (tail) logC(`       ${tail}`);
                cleanupTmp(tmpPath);
            }
            resolve();
        });
    });
}

function scheduleVariantBuild(originPath, info) {
    if (inProgress.has(info.variantPath)) return;
    inProgress.add(info.variantPath);
    enqueueCompression(() =>
        buildVariant(originPath, info).finally(() => {
            inProgress.delete(info.variantPath);
            invalidateStat(info.variantPath); // let the next request see the new file
        })
    );
}

function findOriginCandidates(variantPath) {
    const cmpsdDir  = path.dirname(variantPath);
    const parentDir = path.dirname(cmpsdDir);
    const ext       = path.extname(variantPath).toLowerCase();
    const base      = path.basename(variantPath, ext);

    if (ext === ".avif") {
        return [path.join(parentDir, base + ".png")];
    }
    if (ext === ".mp4") {
        return [path.join(parentDir, base + ".gif"), path.join(parentDir, base + ".mp4")];
    }
    return [];
}

function cleanCmpsdDir(cmpsdDir) {
    let removed = 0;
    let files;
    try { files = fs.readdirSync(cmpsdDir); }
    catch { return removed; }

    for (const name of files) {
        const variantPath = path.join(cmpsdDir, name);

        let stat;
        try { stat = fs.statSync(variantPath); } catch { continue; }
        if (!stat.isFile()) continue;

        const candidates = findOriginCandidates(variantPath);
        if (candidates.length === 0) continue; // not a managed variant extension — leave alone

        const originExists = candidates.some((p) => fs.existsSync(p));
        if (originExists) continue;

        try {
            fs.unlinkSync(variantPath);
            invalidateStat(variantPath);
            removed++;
            logC(`removed orphaned variant ${relPub(variantPath)} (origin missing)`);
        } catch (e) {
            logC(`error: failed to remove orphaned variant ${relPub(variantPath)}: ${e.message}`);
        }
    }

    return removed;
}

function walkForCmpsdDirs(dir) {
    let removed = 0;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return removed; }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.name === CMPSD_DIRNAME) {
            removed += cleanCmpsdDir(fullPath);
        } else {
            removed += walkForCmpsdDirs(fullPath);
        }
    }

    return removed;
}

function cleanupOrphanedVariants(rootDir = PUBLIC_DIR) {
    logC("boot cleanup: scanning for orphaned compressed variants...");
    const removed = walkForCmpsdDirs(rootDir);

    if (removed > 0) {
        logC(`boot cleanup: removed ${removed} orphaned compressed variant${removed === 1 ? "" : "s"}`);
    } else {
        logC("boot cleanup: no orphaned compressed variants found");
    }

    return removed;
}

module.exports = {
    logC,
    isInsideCmpsd,
    getVariantInfo,
    scheduleVariantBuild,
    inProgress,
    cleanupOrphanedVariants,
};
