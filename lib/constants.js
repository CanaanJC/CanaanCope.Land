const path = require("path");
const { getHostingConfig } = require("./siteConfig");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ADMIN_DIR  = path.join(__dirname, "..", "ADMIN");

const hosting = getHostingConfig();

// Env vars still take precedence over config, same as before.
const HOST = process.env.HOST || hosting.host;
const PORT = process.env.PORT ? Number(process.env.PORT) : hosting.port;

// Admin binds the same way the public server does — 0.0.0.0, reachable via
// your machine's LAN IP directly (e.g. http://192.168.x.x:1832). No separate
// host setting needed.
const ADMIN_HOST = process.env.ADMIN_HOST || "0.0.0.0";
const ADMIN_PORT = process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : hosting.adminPort;

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm":  "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico":  "image/x-icon",
    ".txt":  "text/plain; charset=utf-8",
    ".md":   "text/plain; charset=utf-8",
    ".wav":  "audio/wav",
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".pdf":  "application/pdf",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
    ".ttf":  "font/ttf",
    ".otf":  "font/otf",
};

const FOLDER_SUPPORTED = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav)$/i;

const IMAGE_EXT_RE = /^\.(png|jpg|jpeg|gif|webp|avif|svg|ico)$/i;
const VIDEO_EXT_RE = /^\.(mp4|webm)$/i;
const AUDIO_EXT_RE = /^\.(mp3|wav)$/i;

const HWM_IMAGE   = 512 * 1024;
const HWM_AV      = 1024 * 1024;
const HWM_DEFAULT = 64 * 1024;

const STAT_TTL_MS = 2000;

const COMPRESS_ENABLED     = true;
const COMPRESS_CONCURRENCY = 2;
const CMPSD_DIRNAME        = "cmpsd";
const AVIF_CRF              = 32;
const MP4_CRF               = 24;
const FALLBACK_CACHE       = "public, max-age=30";

// Note: X-Frame-Options is deliberately NOT set here. It used to be
// "SAMEORIGIN", which blocked the Blog Editor's own live-preview iframe
// (ADMIN/blog-editor) from embedding article pages at all — the admin
// server and public server run on different ports, and a differing port
// counts as a different origin to the browser even on the same host, so
// SAMEORIGIN silently refused to render anything inside that iframe.
const BASE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer-when-downgrade",
    "Keep-Alive": "timeout=60",
    "Connection": "keep-alive",
};

// Injected server-side into every HTML response's <head> (see
// lib/utils.js: injectBeforeHeadClose, and its call sites in
// lib/staticFile.js / lib/routes.js / lib/embed.js). Never hand-written
// into any .html file on disk — this is the single source of truth for
// which emoji library/version is used sitewide. Twemoji is used to inline-
// replace emoji glyphs (flags in particular — Windows' system emoji font
// has none) with SVGs, falling back to native glyphs if it ever fails to
// load (see public/js/twemoji-init.js).
const TWEMOJI_SCRIPT_TAG = '<script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js"></script>';

module.exports = {
    PUBLIC_DIR,
    ADMIN_DIR,
    HOST,
    PORT,
    ADMIN_HOST,
    ADMIN_PORT,
    MIME_TYPES,
    FOLDER_SUPPORTED,
    IMAGE_EXT_RE,
    VIDEO_EXT_RE,
    AUDIO_EXT_RE,
    HWM_IMAGE,
    HWM_AV,
    HWM_DEFAULT,
    STAT_TTL_MS,
    COMPRESS_ENABLED,
    COMPRESS_CONCURRENCY,
    CMPSD_DIRNAME,
    AVIF_CRF,
    MP4_CRF,
    FALLBACK_CACHE,
    BASE_HEADERS,
    TWEMOJI_SCRIPT_TAG,
};
