const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PUBLIC_DIR } = require("./constants");

const FAVICON_DIR = path.join(PUBLIC_DIR, "media", "favicon");
const ICO_PATH     = path.join(FAVICON_DIR, "favicon.ico");
const PNG_PATH     = path.join(FAVICON_DIR, "favicon.png");
const APPLE_PATH   = path.join(FAVICON_DIR, "apple-touch-icon.png");
const LOGO_PATH    = path.join(PUBLIC_DIR, "media", "logo.png");

const PNG_SIZE   = 64;
const ICO_SIZE   = 48;
const APPLE_SIZE = 180;

function logF(...args) {
    console.log("[favicon]", ...args);
}

function runFfmpeg(args) {
    return new Promise((resolve) => {
        const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
        ff.on("error", () => resolve(false));
        ff.on("close", (code) => resolve(code === 0));
    });
}

function copyFallback(destPath) {
    try {
        fs.copyFileSync(LOGO_PATH, destPath);
    } catch {}
}

function wipeFaviconDir() {
    try {
        fs.rmSync(FAVICON_DIR, { recursive: true, force: true });
    } catch {}
}

function ensureFaviconDir() {
    try {
        fs.mkdirSync(FAVICON_DIR, { recursive: true });
        return true;
    } catch {
        return false;
    }
}

async function generatePngFavicon() {
    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${PNG_SIZE}:${PNG_SIZE}`,
        PNG_PATH,
    ]);

    if (ok && fs.existsSync(PNG_PATH)) return true;
    copyFallback(PNG_PATH);
    return fs.existsSync(PNG_PATH);
}

async function generateIcoFavicon() {
    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${ICO_SIZE}:${ICO_SIZE}`,
        ICO_PATH,
    ]);

    if (ok && fs.existsSync(ICO_PATH)) return true;
    copyFallback(ICO_PATH);
    return fs.existsSync(ICO_PATH);
}

async function generateAppleTouchIcon() {
    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${APPLE_SIZE}:${APPLE_SIZE}`,
        APPLE_PATH,
    ]);

    if (ok && fs.existsSync(APPLE_PATH)) return true;
    copyFallback(APPLE_PATH);
    return fs.existsSync(APPLE_PATH);
}

async function ensureFavicon() {
    wipeFaviconDir();

    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon generation");
        return;
    }

    if (!ensureFaviconDir()) {
        logF("failed to create favicon directory");
        return;
    }

    const [pngOk, icoOk, appleOk] = await Promise.all([
        generatePngFavicon(),
        generateIcoFavicon(),
        generateAppleTouchIcon(),
    ]);

    if (pngOk && icoOk && appleOk) {
        logF("updated");
    } else {
        logF("one or more favicon files failed to generate");
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
