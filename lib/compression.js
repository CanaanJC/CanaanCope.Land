const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const {
    CMPSD_DIRNAME,
    COMPRESS_CONCURRENCY,
    AVIF_CRF,
    MP4_CRF,
    PUBLIC_DIR,
    COMPRESS_STATE_PATH,
    COMPRESS_HASH_INTERVAL_MS,
    COMPRESS_HASH_SETTLE_MS,
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

function stateKey(originPath) {
    return relPub(originPath).split(path.sep).join("/");
}

let state = { version: 1, entries: {} };
let stateDirty = false;
let stateLoaded = false;

function loadState() {
    if (stateLoaded) return state;
    stateLoaded = true;
    try {
        const parsed = JSON.parse(fs.readFileSync(COMPRESS_STATE_PATH, "utf-8"));
        if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
            state = { version: 1, entries: parsed.entries };
        }
    } catch {
        state = { version: 1, entries: {} };
    }
    return state;
}

function persistState() {
    if (!stateDirty) return;
    try {
        const dir = path.dirname(COMPRESS_STATE_PATH);
        fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, `.compression-state.tmp-${process.pid}-${Date.now()}`);
        fs.writeFileSync(tmp, JSON.stringify(state, null, 4));
        fs.renameSync(tmp, COMPRESS_STATE_PATH);
        stateDirty = false;
    } catch (e) {
        logC(`error: failed to persist hash state: ${e.message}`);
    }
}

function getEntry(originPath) {
    loadState();
    return state.entries[stateKey(originPath)] || null;
}

function setEntry(originPath, entry) {
    loadState();
    state.entries[stateKey(originPath)] = entry;
    stateDirty = true;
}

function deleteEntry(key) {
    loadState();
    if (Object.prototype.hasOwnProperty.call(state.entries, key)) {
        delete state.entries[key];
        stateDirty = true;
    }
}

function hashFile(filePath) {
    return new Promise((resolve) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
        stream.on("error", () => resolve(null));
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

async function stableHashFile(filePath) {
    let first;
    try { first = fs.statSync(filePath); } catch { return null; }

    const digest = await hashFile(filePath);
    if (!digest) return null;

    let second;
    try { second = fs.statSync(filePath); } catch { return null; }

    if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) return null;

    return { hash: digest, size: second.size, mtimeMs: second.mtimeMs };
}

const inProgress = new Set();
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

function ffmpegArgsFor(kind, originPath, tmpPath) {
    if (kind === "png") {
        return [
            "-y", "-i", originPath,
            "-c:v", "libaom-av1",
            "-still-picture", "1",
            "-crf", String(AVIF_CRF),
            "-b:v", "0",
            "-cpu-used", "6",
            "-f", "avif",
            tmpPath,
        ];
    }
    if (kind === "gif") {
        return [
            "-y", "-i", originPath,
            "-movflags", "+faststart",
            "-pix_fmt", "yuv420p",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-an",
            tmpPath,
        ];
    }
    return [
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

function runFfmpeg(args) {
    return new Promise((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

        let stderr = "";
        if (ff.stderr) {
            ff.stderr.on("data", (d) => {
                stderr += d.toString();
                if (stderr.length > 8000) stderr = stderr.slice(-8000);
            });
        }

        ff.on("error", (err) => resolve({ ok: false, code: null, err, stderr }));
        ff.on("close", (code) => resolve({ ok: code === 0, code, err: null, stderr }));
    });
}

async function buildVariant(originPath, info) {
    const outDir = path.dirname(info.variantPath);
    const rel    = relPub(originPath);

    try {
        fs.mkdirSync(outDir, { recursive: true });
    } catch (e) {
        logC(`error: mkdir failed for ${relPub(outDir)}: ${e.message}`);
        return;
    }

    const before = await stableHashFile(originPath);
    if (!before) {
        logC(`skip ${rel} — source unreadable or still being written`);
        return;
    }

    const tmpPath = `${info.variantPath}.tmp-${process.pid}-${Date.now()}${info.variantExt}`;
    const started = Date.now();

    const result = await runFfmpeg(ffmpegArgsFor(info.kind, originPath, tmpPath));
    const secs   = ((Date.now() - started) / 1000).toFixed(1);

    if (!result.ok) {
        if (result.err) {
            const hint = result.err.code === "ENOENT" ? " (ffmpeg not found on PATH?)" : "";
            logC(`error: spawn failed for ${rel}: ${result.err.message}${hint}`);
        } else {
            logC(`error: ffmpeg exited ${result.code} for ${rel} (${secs}s)`);
            const tail = result.stderr.trim().split("\n").slice(-4).join(" | ");
            if (tail) logC(`       ${tail}`);
        }
        cleanupTmp(tmpPath);
        return;
    }

    let tmpStat;
    try { tmpStat = fs.statSync(tmpPath); } catch { tmpStat = null; }

    if (!tmpStat || tmpStat.size === 0) {
        logC(`error: empty output for ${rel} (${secs}s)`);
        cleanupTmp(tmpPath);
        return;
    }

    const after = await stableHashFile(originPath);
    if (!after || after.hash !== before.hash) {
        logC(`discard ${rel} — source changed during encode, will retry on next scan`);
        cleanupTmp(tmpPath);
        return;
    }

    try {
        fs.renameSync(tmpPath, info.variantPath);
    } catch (e) {
        logC(`error: finalize failed for ${rel}: ${e.message}`);
        cleanupTmp(tmpPath);
        return;
    }

    setEntry(originPath, {
        hash: after.hash,
        size: after.size,
        mtimeMs: after.mtimeMs,
        variant: stateKey(info.variantPath),
        variantSize: tmpStat.size,
        builtAt: new Date().toISOString(),
    });
    persistState();

    const pct = after.size ? (100 * (1 - tmpStat.size / after.size)).toFixed(1) : "?";
    logC(`done ${rel}  ${fmtBytes(after.size)} → ${fmtBytes(tmpStat.size)} (${pct}% smaller, ${secs}s)`);
}

function scheduleVariantBuild(originPath, info) {
    if (inProgress.has(info.variantPath)) return;
    inProgress.add(info.variantPath);
    enqueueCompression(() =>
        buildVariant(originPath, info).finally(() => {
            inProgress.delete(info.variantPath);
            invalidateStat(info.variantPath);
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

        if (/\.tmp-\d+-\d+\.[a-z0-9]+$/i.test(name)) {
            try {
                fs.unlinkSync(variantPath);
                invalidateStat(variantPath);
                logC(`removed abandoned temp file ${relPub(variantPath)}`);
            } catch {}
            continue;
        }

        const candidates = findOriginCandidates(variantPath);
        if (candidates.length === 0) continue;

        const originExists = candidates.some((p) => {
            try { return fs.statSync(p).isFile(); } catch { return false; }
        });
        if (originExists) continue;

        try {
            fs.unlinkSync(variantPath);
            invalidateStat(variantPath);
            for (const candidate of candidates) deleteEntry(stateKey(candidate));
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
    loadState();
    logC("boot cleanup: scanning for compressed variants whose original no longer exists...");
    const removed = walkForCmpsdDirs(rootDir);
    persistState();

    if (removed > 0) {
        logC(`boot cleanup: removed ${removed} orphaned compressed variant${removed === 1 ? "" : "s"}`);
    } else {
        logC("boot cleanup: no orphaned compressed variants found");
    }

    return removed;
}

function collectOrigins(dir, out) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return out; }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === CMPSD_DIRNAME) continue;
            collectOrigins(fullPath, out);
            continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name.startsWith("._")) continue;

        const info = getVariantInfo(fullPath);
        if (!info) continue;

        out.push({ originPath: fullPath, info });
    }

    return out;
}

let scanning = false;

async function runHashScan(rootDir = PUBLIC_DIR) {
    if (scanning) {
        logC("hash scan already running — skipping this tick");
        return { scanned: 0, queued: 0, pruned: 0 };
    }
    scanning = true;
    loadState();

    const started = Date.now();
    const targets = collectOrigins(rootDir, []);
    const seen    = new Set();

    let queued = 0;
    let unreadable = 0;

    for (const { originPath, info } of targets) {
        const key = stateKey(originPath);
        seen.add(key);

        if (inProgress.has(info.variantPath)) continue;

        const current = await stableHashFile(originPath);
        if (!current) {
            unreadable++;
            continue;
        }

        const entry = getEntry(originPath);

        let variantStat;
        try { variantStat = fs.statSync(info.variantPath); } catch { variantStat = null; }
        const variantPresent = !!variantStat && variantStat.isFile() && variantStat.size > 0;

        if (!variantPresent) {
            logC(`queue ${relPub(originPath)} — no usable compressed file on disk`);
            scheduleVariantBuild(originPath, info);
            queued++;
            continue;
        }

        if (!entry || typeof entry.hash !== "string") {
            setEntry(originPath, {
                hash: current.hash,
                size: current.size,
                mtimeMs: current.mtimeMs,
                variant: stateKey(info.variantPath),
                variantSize: variantStat.size,
                builtAt: new Date().toISOString(),
                adopted: true,
            });
            continue;
        }

        if (entry.hash === current.hash) {
            if (entry.mtimeMs !== current.mtimeMs || entry.size !== current.size) {
                setEntry(originPath, { ...entry, size: current.size, mtimeMs: current.mtimeMs });
            }
            continue;
        }

        logC(`queue ${relPub(originPath)} — content hash changed since last compression`);
        scheduleVariantBuild(originPath, info);
        queued++;
    }

    let pruned = 0;
    for (const key of Object.keys(state.entries)) {
        if (seen.has(key)) continue;
        const absolute = path.join(rootDir, ...key.split("/"));
        let exists = false;
        try { exists = fs.statSync(absolute).isFile(); } catch { exists = false; }
        if (exists) continue;
        deleteEntry(key);
        pruned++;
    }

    persistState();
    scanning = false;

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    logC(`hash scan: ${targets.length} file(s) checked, ${queued} queued for compression, ${pruned} stale record(s) pruned${unreadable ? `, ${unreadable} skipped (unreadable/in-flux)` : ""} (${secs}s)`);

    return { scanned: targets.length, queued, pruned };
}

function startHashScanner(rootDir = PUBLIC_DIR) {
    setTimeout(() => {
        runHashScan(rootDir).catch(e => logC(`hash scan error: ${e.message}`));
    }, COMPRESS_HASH_SETTLE_MS).unref();

    return setInterval(() => {
        runHashScan(rootDir).catch(e => logC(`hash scan error: ${e.message}`));
    }, COMPRESS_HASH_INTERVAL_MS).unref();
}

module.exports = {
    logC,
    isInsideCmpsd,
    getVariantInfo,
    scheduleVariantBuild,
    inProgress,
    cleanupOrphanedVariants,
    runHashScan,
    startHashScanner,
};