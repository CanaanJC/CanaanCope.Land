const path = require("path");
const { ADMIN_DIR, PUBLIC_DIR, CMPSD_DIRNAME } = require("../constants");

const ADMIN_LAYOUT_PATH   = path.join(ADMIN_DIR, "config", "master.json");
const ADMIN_ELEMENTS_DIR  = path.join(ADMIN_DIR, "elements");
const LOGO_PATH         = path.join(PUBLIC_DIR, "media", "logo.png");
const LOGO_VARIANT_PATH = path.join(PUBLIC_DIR, "media", CMPSD_DIRNAME, "logo.avif");

// General small-asset upload cap (logo / library icons / sidebar icons /
// fonts) — these should always be small, so 20MB stays plenty generous
// while still catching genuine mistakes fast.
const MAX_UPLOAD_BYTES  = 20 * 1024 * 1024;

// Blog media manager uploads (images/gifs/video/AUDIO/3D models dropped
// into a blog's own media/ folder) legitimately need a much higher
// ceiling — audio/video files routinely exceed 20MB. 300MB is generous
// while still protecting against genuinely runaway uploads.
const MAX_MEDIA_UPLOAD_BYTES = 300 * 1024 * 1024;

// The Panel Layout editor's own folder name. This panel is what lets you
// get BACK into the layout editor at all — if it's ever removed from every
// column (accidentally, or by dragging it out), there'd be no way to add
// it back through the UI itself. To prevent ever being locked out,
// ensurePanelEditorPresent() guarantees it's always somewhere in the
// layout: if it's missing, it's silently reinserted as the very first item
// of the first column, both whenever the layout is read (GET /api/layout —
// i.e. on the next admin page load) and whenever a new layout is saved
// (PUT /api/layout).
const PANEL_EDITOR_ELEMENT_NAME = "admin-master.json";

// Project root — the directory node.js itself lives in. Generic JSON-file
// editors (e.g. the "master.json" element) target files by a path relative
// to this, e.g. "config/master.json". Also the root the server-size
// indicator measures (mirrors what backup.js actually archives).
const PROJECT_ROOT = path.join(ADMIN_DIR, "..");

// Scratch folder for archive-download archives. Only ever holds at most one
// file at a time in practice — each new download request wipes whatever's
// left over here from the previous one before building the next.
const DOWNLOAD_TMP_DIR = path.join(ADMIN_DIR, ".tmp-downloads");

// ── Asset upload targets (library icons / sidebar link icons) ────────────────
// These folders don't exist in a fresh checkout of the repo (media/ is
// gitignored so the public repo copy never ships anyone's actual media).
// Both are created on-demand by the upload endpoint below, the first time
// anything is ever uploaded through the admin panel.
const LIBRARIES_MEDIA_DIR = path.join(PUBLIC_DIR, "media", "libraries");
const SIDEBAR_MEDIA_DIR   = path.join(PUBLIC_DIR, "media", "sidebar");

const UPLOAD_TARGETS = {
    library: { dir: LIBRARIES_MEDIA_DIR, relPrefix: "media/libraries" },
    sidebar: { dir: SIDEBAR_MEDIA_DIR,   relPrefix: "media/sidebar" },
};

// ── Font uploads (any "font" field in master.json) ────────────────────────
// Fonts always live flat in public/fonts/ — matches the public/-relative
// path convention lib/routes.js already resolves font fields against.
const FONTS_DIR = path.join(PUBLIC_DIR, "fonts");
const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

// ── Blog media manager (Blog Editor's per-article media/ browser) ─────────
// Whitelist EXACTLY mirrors the documented supported media formats:
// Image: .png .jpg .jpeg .webp .svg .avif — Animated image: .gif —
// Video: .mp4 .webm — Audio: .mp3 .wav — 3D model: .stl
const MEDIA_EXT_RE = /\.(png|jpg|jpeg|webp|svg|avif|gif|mp4|webm|mp3|wav|stl)$/i;

// Any path segment starting with ".tmp" is excluded from both backups (see
// lib/backup.js) and the server-size scan below — scratch space that
// shouldn't count toward "how big is this thing" or ever get archived.
const TMP_DIR_RE = /^\.tmp/i;

// Brief cache for the server-size scan — a full recursive stat walk of the
// whole project (potentially including node_modules) on every single
// header paint would be wasteful. 30s is plenty fresh for a "how big is
// this thing" badge.
const SERVER_SIZE_CACHE_MS = 30 * 1000;

module.exports = {
    ADMIN_LAYOUT_PATH,
    ADMIN_ELEMENTS_DIR,
    LOGO_PATH,
    LOGO_VARIANT_PATH,
    MAX_UPLOAD_BYTES,
    MAX_MEDIA_UPLOAD_BYTES,
    PANEL_EDITOR_ELEMENT_NAME,
    PROJECT_ROOT,
    DOWNLOAD_TMP_DIR,
    LIBRARIES_MEDIA_DIR,
    SIDEBAR_MEDIA_DIR,
    UPLOAD_TARGETS,
    FONTS_DIR,
    FONT_EXTS,
    MEDIA_EXT_RE,
    TMP_DIR_RE,
    SERVER_SIZE_CACHE_MS,
};
