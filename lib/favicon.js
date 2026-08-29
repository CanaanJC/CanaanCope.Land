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

// Ensures public/media/favicon/ exists. Called once at the top of
// ensureFavicon(), before any of the three generators run.
function ensureFaviconDir() {
    try {
        fs.mkdirSync(FAVICON_DIR, { recursive: true });
        return true;
    } catch (e) {
        console.error(`[favicon] failed to create ${FAVICON_DIR}: ${e.message}`);
        return false;
    }
}

// Generates media/favicon/favicon.png (used by <link rel="icon">) if it
// doesn't already exist. Never touched again once present.
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

// Generates media/favicon/favicon.ico from logo.png, converting/resizing
// via ffmpeg. This is what browsers/crawlers auto-probe for at
// "/favicon.ico" independent of <link rel="icon">. Only generated once;
// never overwritten after that (same rule as favicon.png).
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
        // .ico fallback copy isn't a valid .ico (it'd just be a renamed
        // PNG), but it still satisfies "some file exists" well enough for
        // browsers that lean on content-sniffing.
        copyFallback(ICO_PATH, "favicon.ico");
    }
}

// Generates media/favicon/apple-touch-icon.png (180x180 — iOS home screen
// icon) from logo.png. Only generated once; never overwritten after that.
// No SVG variant is produced — per source logo not being suitable for it.
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

// Runs once at boot. Ensures media/favicon/ exists, then generates
// favicon.png, favicon.ico, and apple-touch-icon.png — each independently
// and only if missing. None of these files are ever regenerated/overwritten
// once present — manually dropping in your own versions of any of them is
// always safe and permanent. If media/logo.png doesn't exist at all, every
// step is skipped with a log message (nothing to derive icons from).
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
