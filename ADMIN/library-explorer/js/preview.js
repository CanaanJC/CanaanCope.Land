
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
