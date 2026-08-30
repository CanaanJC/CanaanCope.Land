// ─────────────────────────────────────────────────────────────────────────────
// Full-bleed live preview — points an iframe at the PUBLIC site's host/port
// (never the admin server's own port).
//
// Two device modes, chosen with a Desktop/Mobile toggle that appears in the
// top bar (in place of the edit-mode toggle) only while preview is on:
//
//   Desktop — the iframe fills the entire preview area. Default every time
//             preview is entered.
//   Mobile  — the iframe is constrained to a phone-shaped frame whose
//             aspect ratio comes from library.json's
//             preview.mobileAspectRatio ("X:Y"), applied via the
//             --preview-mobile-ratio CSS variable (see library-config.js /
//             preview.css). Nothing here is hardcoded to any device shape.
//
// Switching device RELOADS the page in the iframe (src is re-set rather
// than just resized) so the site's own mobile.js / media queries re-run
// against the new viewport size instead of keeping whatever layout it
// picked at the old width.
//
// The About Me page has no route of its own — its content renders on the
// site's front page — so its "article URL" is the site root.
// ─────────────────────────────────────────────────────────────────────────────

import { ABOUT_ME_URL_PATH } from "./library-browser.js";

function isAboutMeBlog(blog) {
    return !!blog && (blog.isAboutMe === true || blog.urlPath === ABOUT_ME_URL_PATH);
}

export function createPreview({
    toggleBtn, editorViewEl, previewViewEl,
    modeToggleGroup,
    deviceToggleGroup, deviceDesktopBtn, deviceMobileBtn,
    previewContainerEl, previewIframeEl,
    saveBtn, getSelectedBlog, getHostingPort,
}) {
    let previewOn = false;
    let device = "desktop"; // "desktop" | "mobile"

    async function buildArticleUrl(blog) {
        if (!blog) return null;
        const port = await getHostingPort();
        if (!port) return null;
        const base = `http://${window.location.hostname}:${port}`;
        return isAboutMeBlog(blog) ? `${base}/` : `${base}/${blog.urlPath}`;
    }

    // Fully reloads the framed page. A cache-busting param guarantees a
    // genuine re-render at the new frame size rather than a restored
    // bfcache/back-forward snapshot laid out for the old one.
    async function updateSrc() {
        const blog = getSelectedBlog();
        if (!blog) return;
        const url = await buildArticleUrl(blog);
        if (!url) { previewIframeEl.src = "about:blank"; return; }
        const sep = url.includes("?") ? "&" : "?";
        previewIframeEl.src = `${url}${sep}_bePreview=${Date.now()}`;
    }

    function applyDeviceClass() {
        previewContainerEl.classList.toggle("be-preview-container--mobile", device === "mobile");
        if (deviceDesktopBtn) deviceDesktopBtn.classList.toggle("be-toggle-btn--active", device === "desktop");
        if (deviceMobileBtn)  deviceMobileBtn.classList.toggle("be-toggle-btn--active", device === "mobile");
    }

    function setDevice(next) {
        if (next === device) return;
        device = next;
        applyDeviceClass();
        // Resize the frame first, THEN reload into it, so the page boots
        // already knowing its real viewport width.
        requestAnimationFrame(() => { if (previewOn) updateSrc(); });
    }

    if (deviceDesktopBtn) deviceDesktopBtn.addEventListener("click", () => setDevice("desktop"));
    if (deviceMobileBtn)  deviceMobileBtn.addEventListener("click", () => setDevice("mobile"));

    function enter() {
        previewOn = true;
        toggleBtn.textContent = "Hide Preview";
        toggleBtn.classList.add("be-toggle-btn--active");
        editorViewEl.hidden  = true;
        previewViewEl.hidden = false;
        modeToggleGroup.hidden = true;
        if (deviceToggleGroup) deviceToggleGroup.hidden = false;
        saveBtn.hidden = true;

        // Always start on Desktop, regardless of what was last used.
        device = "desktop";
        applyDeviceClass();

        updateSrc();
    }

    function exit() {
        previewOn = false;
        toggleBtn.textContent = "Show Preview";
        toggleBtn.classList.remove("be-toggle-btn--active");
        editorViewEl.hidden  = false;
        previewViewEl.hidden = true;
        // Never re-show the content/config toggle for the About Me page —
        // it has no config.json.
        modeToggleGroup.hidden = isAboutMeBlog(getSelectedBlog());
        if (deviceToggleGroup) deviceToggleGroup.hidden = true;
        saveBtn.hidden = false;
        saveBtn.disabled = !getSelectedBlog();
        previewIframeEl.src = "about:blank";
    }

    toggleBtn.addEventListener("click", () => {
        if (!getSelectedBlog()) return;
        if (previewOn) exit(); else enter();
    });

    return {
        isOn: () => previewOn,
        getDevice: () => device,
        refreshIfOn: () => { if (previewOn) updateSrc(); },
        buildArticleUrl,
    };
}
