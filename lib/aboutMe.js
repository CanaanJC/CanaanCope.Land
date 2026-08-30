// ─────────────────────────────────────────────────────────────────────────────
// "About Me" special page.
//
// public/aboutme/ is NOT a library blog — it lives outside public/libraries/
// entirely and powers the site's About Me section. It is nevertheless
// editable through the Library Explorer exactly like any other blog
// (content.md + its own media/ folder), and is rendered at the BOTTOM of
// the library list with the normal blog icon.
//
// It can never be deleted, renamed or moved through the UI (the Library
// Browser deliberately gives it no context menu), and this module
// guarantees it always exists on boot: if the folder, its content.md, or
// its (empty) media/ folder are missing, they're created.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");

// URL/api path used by the admin frontend for this page. Deliberately a
// single, reserved segment — no library may ever use it (libraries live
// under public/libraries/, so there is no collision on disk either).
const ABOUT_ME_SLUG = "aboutme";

const ABOUT_ME_DIR       = path.join(PUBLIC_DIR, ABOUT_ME_SLUG);
const ABOUT_ME_CONTENT   = path.join(ABOUT_ME_DIR, "content.md");
const ABOUT_ME_MEDIA_DIR = path.join(ABOUT_ME_DIR, "media");

// True if `urlPath` (as sent by the admin frontend) refers to the About Me
// page. Accepts stray leading/trailing slashes so callers don't have to
// normalize first.
function isAboutMePath(urlPath) {
    if (typeof urlPath !== "string") return false;
    const segments = urlPath.split("/").filter(Boolean);
    return segments.length === 1 && segments[0] === ABOUT_ME_SLUG;
}

// Creates anything missing. Never overwrites an existing content.md — an
// empty file is a perfectly valid (brand new) About Me page.
function ensureAboutMe() {
    try {
        fs.mkdirSync(ABOUT_ME_DIR, { recursive: true });
        fs.mkdirSync(ABOUT_ME_MEDIA_DIR, { recursive: true });

        if (!fs.existsSync(ABOUT_ME_CONTENT)) {
            fs.writeFileSync(ABOUT_ME_CONTENT, "", "utf-8");
            console.log(`[aboutme] created ${ABOUT_ME_CONTENT}`);
        }
    } catch (e) {
        console.error(`[aboutme] failed to ensure About Me page: ${e.message}`);
    }
}

module.exports = {
    ABOUT_ME_SLUG,
    ABOUT_ME_DIR,
    ABOUT_ME_CONTENT,
    ABOUT_ME_MEDIA_DIR,
    isAboutMePath,
    ensureAboutMe,
};
