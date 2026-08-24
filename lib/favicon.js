const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { PUBLIC_DIR } = require("./constants");

const FAVICON_REL     = "media/favicon.png";
const ICO_REL         = "favicon.ico"; // served from the actual site root
const LOGO_REL        = "media/logo.png";
const FAVICON_PATH    = path.join(PUBLIC_DIR, FAVICON_REL);
const ICO_PATH        = path.join(PUBLIC_DIR, ICO_REL);
const LOGO_PATH       = path.join(PUBLIC_DIR, LOGO_REL);
const FAVICON_SIZE    = 64;
const ICO_SIZE        = 32; // classic favicon.ico size

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

// Generates media/favicon.png (a resized PNG, used by the <link rel="icon">
// tag) if it doesn't already exist. Never touched again once present.
async function ensurePngFavicon() {
    if (fs.existsSync(FAVICON_PATH)) return;
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.png generation");
        return;
    }

    logF("media/favicon.png missing — generating from logo.png");

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${FAVICON_SIZE}:${FAVICON_SIZE}`,
        FAVICON_PATH,
    ]);

    if (ok && fs.existsSync(FAVICON_PATH)) {
        logF(`generated media/favicon.png (${FAVICON_SIZE}x${FAVICON_SIZE}) from logo.png`);
    } else {
        copyFallback(FAVICON_PATH, "favicon.png");
    }
}

// Generates a real favicon.ico at the site root (public/favicon.ico) from
// logo.png, converting/resizing via ffmpeg. This is what browsers/crawlers
// auto-probe for at "/favicon.ico" with zero HTML involved — a silent
// fallback net independent of the <link rel="icon"> tag. Only generated
// once; never overwritten after that (same rule as favicon.png).
async function ensureIcoFavicon() {
    if (fs.existsSync(ICO_PATH)) return;
    if (!fs.existsSync(LOGO_PATH)) {
        logF("no media/logo.png found — skipping favicon.ico generation");
        return;
    }

    logF("favicon.ico missing at site root — converting from logo.png");

    const ok = await runFfmpeg([
        "-y", "-i", LOGO_PATH,
        "-vf", `scale=${ICO_SIZE}:${ICO_SIZE}`,
        ICO_PATH,
    ]);

    if (ok && fs.existsSync(ICO_PATH)) {
        logF(`generated favicon.ico (${ICO_SIZE}x${ICO_SIZE}) from logo.png`);
    } else {
        // .ico fallback copy isn't a valid .ico (it'd just be a renamed PNG),
        // but it still satisfies the "some file exists at /favicon.ico"
        // case well enough for browsers that lean on content-sniffing.
        copyFallback(ICO_PATH, "favicon.ico");
    }
}

// Runs once at boot. Generates both media/favicon.png (for the <link> tag)
// and public/favicon.ico (for the root auto-probe), each independently and
// only if missing. Neither file is ever regenerated/overwritten once present
// — manually dropping in your own favicon.png or favicon.ico is always safe
// and permanent.
async function ensureFavicon() {
    await ensurePngFavicon();
    await ensureIcoFavicon();
}

function getFaviconUrl() {
    return fs.existsSync(FAVICON_PATH) ? `/${FAVICON_REL}` : null;
}

module.exports = { ensureFavicon, getFaviconUrl, FAVICON_PATH, ICO_PATH, LOGO_PATH };
