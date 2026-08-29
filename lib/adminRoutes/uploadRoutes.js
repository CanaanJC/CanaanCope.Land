const fs = require("fs");
const path = require("path");
const {
    LOGO_PATH, LOGO_VARIANT_PATH, MAX_UPLOAD_BYTES,
    UPLOAD_TARGETS, FONTS_DIR, FONT_EXTS,
} = require("./constants");
const { sendJson, readBody } = require("./shared");
const { invalidateStat } = require("../fsCache");

// Sanitizes a user-supplied name (library name / sidebar link text) down to
// a safe filename stem: lowercased, non-alphanumeric runs collapsed to a
// single dash, leading/trailing dashes trimmed. Returns "" if nothing usable
// remains (caller treats that as an error — never writes a blank filename).
function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Sanitizes an uploaded font's ORIGINAL filename down to a safe filename
// while preserving its extension and case (font family names are often
// case-sensitive/meaningful, unlike the lowercased asset-name sanitizer
// above). Returns null if the extension isn't one of the 4 supported font
// types. Unsafe characters in the base name are collapsed to dashes.
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

    // ── Generic asset upload endpoint — library icons / sidebar link icons ──
    //
    // POST /api/upload/library?name=<libraryName>[&overwrite=true]
    // POST /api/upload/sidebar?name=<linkText>[&overwrite=true]
    //
    // Body is the raw PNG bytes. Writes to:
    //   public/media/libraries/<sanitized-name>.png
    //   public/media/sidebar/<sanitized-name>.png
    // creating the target directory if it doesn't exist yet (it won't, on a
    // fresh checkout of the repo, since media/ is gitignored).
    //
    // If the target file already exists and ?overwrite=true was NOT passed,
    // responds 409 { exists: true } instead of writing — the frontend is
    // expected to show its own confirm dialog (matching the existing
    // delete-confirm UX) and retry the same request with ?overwrite=true.
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

    // ── Font upload endpoint — any "font" field in master.json ───────────
    //
    // POST /api/upload/font?filename=<originalFileName>[&oldFilename=<name>][&deleteOld=true|false]
    //
    // Body is the raw font file bytes (.ttf/.otf/.woff/.woff2). Writes to:
    //   public/fonts/<sanitized-filename>
    // creating the folder if it doesn't exist yet.
    //
    // The frontend is entirely responsible for deciding WHETHER to prompt
    // the user and what to send here — this endpoint just does exactly what
    // it's told:
    //   - always writes/overwrites public/fonts/<sanitized filename>
    //   - if deleteOld=true AND oldFilename is given AND it differs from the
    //     new filename, deletes public/fonts/<oldFilename> first (best-effort
    //     — a missing old file is not an error)
    //   - if deleteOld is omitted/false, any previous font file (including a
    //     same-named one on the old field value) is simply left in place, so
    //     multiple font files can coexist in public/fonts/.
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

        // oldFilename is only ever compared/used as a bare basename — never
        // treated as a path, so there's no traversal risk even though it
        // comes straight from the query string.
        const oldFilename = oldFilenameRaw ? path.basename(oldFilenameRaw) : "";

        try {
            fs.mkdirSync(FONTS_DIR, { recursive: true });

            if (deleteOld && oldFilename && oldFilename !== filename) {
                const oldPath = path.join(FONTS_DIR, oldFilename);
                try {
                    fs.unlinkSync(oldPath);
                    invalidateStat(oldPath);
                } catch {
                    // Old file already gone / never existed — not an error.
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
