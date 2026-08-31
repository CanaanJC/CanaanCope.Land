const fs = require("fs");
const path = require("path");
const {
    LOGO_PATH, LOGO_VARIANT_PATH, MAX_UPLOAD_BYTES,
    UPLOAD_TARGETS, FONTS_DIR, FONT_EXTS,
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

function sanitizeFontFilename(rawName) {
    const ext = path.extname(rawName || "").toLowerCase();
    if (!FONT_EXTS.has(ext)) return null;

    let base = path.basename(rawName || "", path.extname(rawName || ""));
    base = base
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "");

    if (!base) base = "font";
    return `${base}${ext}`;
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
        const query         = new URL(req.url, "http://internal").searchParams;
        const rawFilename   = query.get("filename");
        const oldFilenameRaw = query.get("oldFilename") || "";
        const deleteOld     = query.get("deleteOld") === "true";

        const filename = sanitizeFontFilename(rawFilename);
        if (!filename) {
            sendJson(res, 400, { error: "Missing or invalid \"filename\" (must be .ttf, .otf, .woff, or .woff2)" });
            return true;
        }

        const oldFilename = oldFilenameRaw ? path.basename(oldFilenameRaw) : "";

        try {
            fs.mkdirSync(FONTS_DIR, { recursive: true });

            if (deleteOld && oldFilename && oldFilename !== filename) {
                const oldPath = path.join(FONTS_DIR, oldFilename);
                try {
                    fs.unlinkSync(oldPath);
                    invalidateStat(oldPath);
                } catch {
                }
            }

            const buf = await readBody(req, MAX_UPLOAD_BYTES);
            if (buf.length === 0) {
                sendJson(res, 400, { error: "Empty upload" });
                return true;
            }

            const destPath = path.join(FONTS_DIR, filename);
            fs.writeFileSync(destPath, buf);
            invalidateStat(destPath);

            sendJson(res, 200, { ok: true, path: `fonts/${filename}` });
        } catch (e) {
            sendJson(res, 500, { error: `Font upload failed: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleUploadRoutes, sanitizeAssetName, sanitizeFontFilename };
