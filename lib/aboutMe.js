
const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");

const ABOUT_ME_SLUG = "aboutme";

const ABOUT_ME_DIR       = path.join(PUBLIC_DIR, ABOUT_ME_SLUG);
const ABOUT_ME_CONTENT   = path.join(ABOUT_ME_DIR, "content.md");
const ABOUT_ME_MEDIA_DIR = path.join(ABOUT_ME_DIR, "media");

function isAboutMePath(urlPath) {
    if (typeof urlPath !== "string") return false;
    const segments = urlPath.split("/").filter(Boolean);
    return segments.length === 1 && segments[0] === ABOUT_ME_SLUG;
}

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
