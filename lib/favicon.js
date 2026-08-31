const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PUBLIC_DIR } = require("./constants");

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
        logF(`copied logo.png as ${label} (ffmpeg unavailable/failed)`);
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

async function ensurePngFavicon() {
    if (fs.existsSync(PNG_PATH)) return;
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.png generation");
        return;
    }

    logF("media/favicon/favicon.png missing — generating from logo.png");

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${PNG_SIZE}:${PNG_SIZE}`,
        PNG_PATH,
    ]);

    if (ok && fs.existsSync(PNG_PATH)) {
        logF(`generated media/favicon/favicon.png (${PNG_SIZE}x${PNG_SIZE}) from logo.png`);
    } else {
        copyFallback(PNG_PATH, "favicon.png");
    }
}

async function ensureIcoFavicon() {
    if (fs.existsSync(ICO_PATH)) return;
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.ico generation");
        return;
    }

    logF("media/favicon/favicon.ico missing — converting from logo.png");

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${ICO_SIZE}:${ICO_SIZE}`,
        ICO_PATH,
    ]);

    if (ok && fs.existsSync(ICO_PATH)) {
        logF(`generated media/favicon/favicon.ico (${ICO_SIZE}x${ICO_SIZE}) from logo.png`);
    } else {
        copyFallback(ICO_PATH, "favicon.ico");
    }
}

async function ensureAppleTouchIcon() {
    if (fs.existsSync(APPLE_PATH)) return;
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping apple-touch-icon.png generation");
        return;
    }

    logF("media/favicon/apple-touch-icon.png missing — generating from logo.png");

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${APPLE_SIZE}:${APPLE_SIZE}`,
        APPLE_PATH,
    ]);

    if (ok && fs.existsSync(APPLE_PATH)) {
        logF(`generated media/favicon/apple-touch-icon.png (${APPLE_SIZE}x${APPLE_SIZE}) from logo.png`);
    } else {
        copyFallback(APPLE_PATH, "apple-touch-icon.png");
    }
}

async function ensureFavicon() {
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping all favicon generation");
        return;
    }
    if (!ensureFaviconDir()) return;

    await ensurePngFavicon();
    await ensureIcoFavicon();
    await ensureAppleTouchIcon();
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
