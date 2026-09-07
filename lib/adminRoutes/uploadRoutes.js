const fs = require("fs");
const path = require("path");
const {
    LOGO_PATH, LOGO_VARIANT_PATH, MAX_UPLOAD_BYTES,
    UPLOAD_TARGETS, FONTS_DIR, FONT_EXTS,
    ICONS_DIR, ICON_EXTS, ICON_REL_PREFIX,
} = require("./constants");
const { sendJson, readBody } = require("./shared");
const { invalidateStat } = require("../fsCache");

function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function sanitizeFilenameWithExts(rawName, allowedExts, fallbackBase) {
    const ext = path.extname(rawName || "").toLowerCase();
    if (!allowedExts.has(ext)) return null;

    let base = path.basename(rawName || "", path.extname(rawName || ""));
    base = base
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");

    if (!base) base = fallbackBase;
    return `${base}${ext}`;
}

function sanitizeFontFilename(rawName) {
    return sanitizeFilenameWithExts(rawName, FONT_EXTS, "font");
}

function sanitizeIconFilename(rawName) {
    return sanitizeFilenameWithExts(rawName, ICON_EXTS, "icon");
}

async function handleKeepNameUpload(req, res, opts) {
    const { dir, relPrefix, sanitize, label, extListText } = opts;

    const query          = new URL(req.url, "http://internal").searchParams;
    const rawFilename    = query.get("filename");
    const oldFilenameRaw = query.get("oldFilename") || "";
    const deleteOld      = query.get("deleteOld") === "true";

    const filename = sanitize(rawFilename);
    if (!filename) {
        sendJson(res, 400, { error: `Missing or invalid "filename" (must be ${extListText})` });
        return;
    }

    const oldFilename = oldFilenameRaw ? path.basename(oldFilenameRaw) : "";

    try {
        fs.mkdirSync(dir, { recursive: true });

        if (deleteOld && oldFilename && oldFilename !== filename) {
            const oldPath = path.join(dir, oldFilename);
            try {
                fs.unlinkSync(oldPath);
                invalidateStat(oldPath);
            } catch {
            }
        }

        const buf = await readBody(req, MAX_UPLOAD_BYTES);
        if (buf.length === 0) {
            sendJson(res, 400, { error: "Empty upload" });
            return;
        }

        const destPath = path.join(dir, filename);
        fs.writeFileSync(destPath, buf);
        invalidateStat(destPath);

        sendJson(res, 200, { ok: true, path: `${relPrefix}/${filename}` });
    } catch (e) {
        sendJson(res, 500, { error: `${label} upload failed: ${e.message}` });
    }
}

async function handleUploadRoutes(req, res, safePath, method) {
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

    if (safePath === "/api/upload/font" && method === "POST") {
        await handleKeepNameUpload(req, res, {
            dir: FONTS_DIR,
            relPrefix: "fonts",
            sanitize: sanitizeFontFilename,
            label: "Font",
            extListText: ".ttf, .otf, .woff, or .woff2",
        });
        return true;
    }

    if (safePath === "/api/upload/icon" && method === "POST") {
        await handleKeepNameUpload(req, res, {
            dir: ICONS_DIR,
            relPrefix: ICON_REL_PREFIX,
            sanitize: sanitizeIconFilename,
            label: "Icon",
            extListText: ".png, .jpg, .jpeg, .webp, .svg, .avif, .gif, .ico, or .bmp",
        });
        return true;
    }

    return false;
}

module.exports = {
    handleUploadRoutes,
    sanitizeAssetName,
    sanitizeFontFilename,
    sanitizeIconFilename,
};