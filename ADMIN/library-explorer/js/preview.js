// ─────────────────────────────────────────────────────────────────────────────
// Full-bleed live preview — points an iframe at the PUBLIC site's host/port
// (never the admin server's own port). Desktop-only — this editor is not
// intended for mobile, so no device toggle.
// ─────────────────────────────────────────────────────────────────────────────

export function createPreview({
    toggleBtn, editorViewEl, previewViewEl,
    modeToggleGroup,
    previewContainerEl, previewIframeEl,
    saveBtn, getSelectedBlog, getHostingPort,
}) {
    let previewOn = false;

    async function buildArticleUrl(blog) {
        if (!blog) return null;
        const port = await getHostingPort();
        if (!port) return null;
        return `http://${window.location.hostname}:${port}/${blog.urlPath}`;
    }

    async function updateSrc() {
        const blog = getSelectedBlog();
        if (!blog) return;
        const url = await buildArticleUrl(blog);
        previewIframeEl.src = url || "about:blank";
    }

    function enter() {
        previewOn = true;
        toggleBtn.textContent = "Hide Preview";
        toggleBtn.classList.add("be-toggle-btn--active");
        editorViewEl.hidden  = true;
        previewViewEl.hidden = false;
        modeToggleGroup.hidden = true;
        saveBtn.hidden = true;
        updateSrc();
    }

    function exit() {
        previewOn = false;
        toggleBtn.textContent = "Show Preview";
        toggleBtn.classList.remove("be-toggle-btn--active");
        editorViewEl.hidden  = false;
        previewViewEl.hidden = true;
        modeToggleGroup.hidden = false;
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
        refreshIfOn: () => { if (previewOn) updateSrc(); },
        buildArticleUrl,
    };
}
