const path = require("path");
const { ADMIN_DIR, PUBLIC_DIR, CMPSD_DIRNAME } = require("../constants");

const ADMIN_LAYOUT_PATH   = path.join(ADMIN_DIR, "config", "master.json");
const ADMIN_ELEMENTS_DIR  = path.join(ADMIN_DIR, "elements");
const LOGO_PATH         = path.join(PUBLIC_DIR, "media", "logo.png");
const LOGO_VARIANT_PATH = path.join(PUBLIC_DIR, "media", CMPSD_DIRNAME, "logo.avif");

const MAX_UPLOAD_BYTES  = 20 * 1024 * 1024;

const MAX_MEDIA_UPLOAD_BYTES = 300 * 1024 * 1024;

const PANEL_EDITOR_ELEMENT_NAME = "pannel_config";

const PROJECT_ROOT = path.join(ADMIN_DIR, "..");

const DOWNLOAD_TMP_DIR = path.join(ADMIN_DIR, ".tmp-downloads");

const LIBRARIES_MEDIA_DIR = path.join(PUBLIC_DIR, "media", "libraries");
const SIDEBAR_MEDIA_DIR   = path.join(PUBLIC_DIR, "media", "sidebar");

const UPLOAD_TARGETS = {
    library: { dir: LIBRARIES_MEDIA_DIR, relPrefix: "media/libraries" },
    sidebar: { dir: SIDEBAR_MEDIA_DIR,   relPrefix: "media/sidebar" },
};

const FONTS_DIR = path.join(PUBLIC_DIR, "fonts");
const FONT_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

const MEDIA_EXT_RE = /\.(png|jpg|jpeg|webp|svg|avif|gif|mp4|webm|mp3|wav|stl)$/i;

const TMP_DIR_RE = /^\.tmp/i;

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
