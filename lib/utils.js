const path = require("path");
const {
    MIME_TYPES,
    IMAGE_EXT_RE,
    VIDEO_EXT_RE,
    AUDIO_EXT_RE,
    HWM_IMAGE,
    HWM_AV,
    HWM_DEFAULT,
    BASE_HEADERS,
    PUBLIC_DIR,
    TWEMOJI_SCRIPT_TAG,
} = require("./constants");

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function getCacheControl(ext) {
    if (/^\.(png|jpg|jpeg|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|woff|woff2|ttf|otf|wasm)$/i.test(ext)) {
        return "public, max-age=31536000, immutable";
    }
    if (/^\.(css|js|mjs)$/i.test(ext)) {
        return "public, max-age=3600";
    }
    if (/^\.(html|htm|json|md|txt|pdf)$/i.test(ext)) {
        return "public, max-age=60";
    }
    return "public, max-age=300";
}

function makeETag(stat) {
    return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

function pickHighWaterMark(ext) {
    if (IMAGE_EXT_RE.test(ext)) return HWM_IMAGE;
    if (VIDEO_EXT_RE.test(ext) || AUDIO_EXT_RE.test(ext)) return HWM_AV;
    return HWM_DEFAULT;
}

function isRootPath(safePath) {
    return safePath === "/" || safePath === "/index.html";
}

function buildStdHeaders(safePath) {
    if (isRootPath(safePath)) return BASE_HEADERS;
    return { ...BASE_HEADERS, "X-Robots-Tag": "noindex, follow" };
}

function fmtBytes(n) {
    if (!n && n !== 0) return "?";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function relPub(p) {
    return path.relative(PUBLIC_DIR, p);
}

function parseRange(rangeHeader, size) {
    if (!rangeHeader) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m) return null;
    const hasStart = m[1] !== "";
    const hasEnd   = m[2] !== "";
    let start, end;
    if (!hasStart && !hasEnd) return null;
    if (!hasStart) {
        const suffix = parseInt(m[2], 10);
        if (isNaN(suffix) || suffix <= 0) return null;
        start = Math.max(0, size - suffix);
        end   = size - 1;
    } else {
        start = parseInt(m[1], 10);
        end   = hasEnd ? parseInt(m[2], 10) : size - 1;
    }
    if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= size) return null;
    return { start, end };
}

function sanitizePath(urlPath) {
    const cleanPath = urlPath.split("?")[0].split("#")[0];
    let decoded;
    try { decoded = decodeURIComponent(cleanPath); }
    catch { return "/"; }
    const normalized = path.posix.normalize(decoded);
    if (normalized.includes("..")) return "/";
    return normalized;
}

function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function escape(str) {
    return String(str)
        .replace(/&/g,  "&amp;")
        .replace(/"/g,  "&quot;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;");
}

function isSafeSegment(seg) {
    return typeof seg === "string" &&
        seg.length > 0 &&
        !seg.includes("/") &&
        !seg.includes("\\") &&
        !seg.includes("..") &&
        seg !== ".";
}

function injectBeforeHeadClose(html, snippet) {
    if (typeof html !== "string" || !/<\/head>/i.test(html)) return html;
    return html.replace(/<\/head>/i, `    ${snippet}\n  </head>`);
}

function injectTwemoji(html) {
    return injectBeforeHeadClose(html, TWEMOJI_SCRIPT_TAG);
}

module.exports = {
    getMimeType,
    getCacheControl,
    makeETag,
    pickHighWaterMark,
    isRootPath,
    buildStdHeaders,
    fmtBytes,
    relPub,
    parseRange,
    sanitizePath,
    naturalSort,
    escape,
    isSafeSegment,
    injectBeforeHeadClose,
    injectTwemoji,
};
