const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PUBLIC_DIR, CMPSD_DIRNAME } = require("./constants");

const FAVICON_DIR = path.join(PUBLIC_DIR, "media", "favicon");
const ICO_PATH     = path.join(FAVICON_DIR, "favicon.ico");
const PNG_PATH     = path.join(FAVICON_DIR, "favicon.png");
const APPLE_PATH   = path.join(FAVICON_DIR, "apple-touch-icon.png");
const LOGO_PATH    = path.join(PUBLIC_DIR, "media", "logo.png");

const PNG_SIZE   = 64;   // favicon.png — used by <link rel="icon">
const ICO_SIZE   = 48;   // favicon.ico — classic root/bookmark icon size
const APPLE_SIZE = 180;  // apple-touch-icon.png — iOS home screen icon

function logF(...args) {
    console.log("[favicon]", ...args);
}

function runFfmpeg(args) {
    return new Promise((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        if (ff.stderr) ff.stderr.on("data", (d) => { stderr += d.toString(); });

        ff.on("error", (err) => {
            const hint = err.code === "ENOENT" ? " (ffmpeg not found on PATH?)" : "";
            console.error(`[favicon] ffmpeg spawn failed: ${err.message}${hint}`);
            resolve(false);
        });

        ff.on("close", (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                console.error(`[favicon] ffmpeg exited ${code}`);
                const tail = stderr.trim().split("\n").slice(-4).join(" | ");
                if (tail) console.error(`[favicon]        ${tail}`);
                resolve(false);
            }
        });
    });
}

function copyFallback(destPath, label) {
    try {
        fs.copyFileSync(LOGO_PATH, destPath);
    } catch (e) {
        console.error(`[favicon] fallback copy failed for ${label}: ${e.message}`);
    }
}

function ensureFaviconDir() {
    try {
        fs.mkdirSync(FAVICON_DIR, { recursive: true });
        return true;
    } catch (e) {
        console.error(`[favicon] failed to create ${FAVICON_DIR}: ${e.message}`);
        return false;
    }
}

// Wipes every file currently in media/favicon/ so nothing stale survives a
// logo.png change. Called unconditionally on every boot, before regenerating.
function wipeFaviconDir() {
    if (!fs.existsSync(FAVICON_DIR)) return;
    try {
        for (const name of fs.readdirSync(FAVICON_DIR)) {
            const p = path.join(FAVICON_DIR, name);
            try {
                fs.rmSync(p, { recursive: true, force: true });
            } catch (e) {
                console.error(`[favicon] failed to remove ${p}: ${e.message}`);
            }
        }
    } catch (e) {
        console.error(`[favicon] failed to read ${FAVICON_DIR} for wipe: ${e.message}`);
    }
}

// Recursively finds and deletes every "cmpsd" compressed-variant cache dir
// under PUBLIC_DIR, so old compressed thumbnails/media (which may have been
// derived from an old logo or other now-stale source files) don't linger
// past a server restart. These are regenerated on-demand by lib/compression.js
// the next time each original file is requested.
function wipeCmpsdDirs(dir = PUBLIC_DIR) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.name === CMPSD_DIRNAME) {
            try {
                fs.rmSync(fullPath, { recursive: true, force: true });
            } catch (e) {
                console.error(`[favicon] failed to remove ${fullPath}: ${e.message}`);
            }
        } else {
            wipeCmpsdDirs(fullPath);
        }
    }
}

async function generatePngFavicon() {
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.png generation");
        return false;
    }

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${PNG_SIZE}:${PNG_SIZE}`,
        PNG_PATH,
    ]);

    if (ok && fs.existsSync(PNG_PATH)) return true;
    copyFallback(PNG_PATH, "favicon.png");
    return fs.existsSync(PNG_PATH);
}

async function generateIcoFavicon() {
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.ico generation");
        return false;
    }

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${ICO_SIZE}:${ICO_SIZE}`,
        ICO_PATH,
    ]);

    if (ok && fs.existsSync(ICO_PATH)) return true;
    copyFallback(ICO_PATH, "favicon.ico");
    return fs.existsSync(ICO_PATH);
}

async function generateAppleTouchIcon() {
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping apple-touch-icon.png generation");
        return false;
    }

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${APPLE_SIZE}:${APPLE_SIZE}`,
        APPLE_PATH,
    ]);

    if (ok && fs.existsSync(APPLE_PATH)) return true;
    copyFallback(APPLE_PATH, "apple-touch-icon.png");
    return fs.existsSync(APPLE_PATH);
}

// Runs on every server boot. Always deletes the entire favicon folder first
// (so a changed logo.png is always picked up, never stale) and also clears
// out any "cmpsd" compressed-variant cache dirs across public/ (they're
// regenerated on demand). If logo.png exists and all three favicon files
// regenerate successfully, logs a single concise "[favicon] updated" line —
// otherwise falls back to the normal missing/generate logging so problems
// are still visible.
async function ensureFavicon() {
    wipeCmpsdDirs();

    if (!fs.existsSync(LOGO_PATH)) {
        wipeFaviconDir();
        logF("no media/logo.png found — skipping all favicon generation");
        return;
    }

    wipeFaviconDir();
    if (!ensureFaviconDir()) return;

    const [pngOk, icoOk, appleOk] = await Promise.all([
        generatePngFavicon(),
        generateIcoFavicon(),
        generateAppleTouchIcon(),
    ]);

    if (pngOk && icoOk && appleOk) {
        logF("updated");
    } else {
        logF("one or more favicon files failed to generate — see errors above");
    }
}

function getFaviconUrl() {
    return fs.existsSync(PNG_PATH) ? "/media/favicon/favicon.png" : null;
}

function getFaviconIcoUrl() {
    return fs.existsSync(ICO_PATH) ? "/media/favicon/favicon.ico" : null;
}

function getAppleTouchIconUrl() {
    return fs.existsSync(APPLE_PATH) ? "/media/favicon/apple-touch-icon.png" : null;
}

module.exports = {
    ensureFavicon,
    getFaviconUrl,
    getFaviconIcoUrl,
    getAppleTouchIconUrl,
    FAVICON_DIR,
    ICO_PATH,
    PNG_PATH,
    APPLE_PATH,
    LOGO_PATH,
};
