import { loadBlogConfig } from "./library-config.js";
import { mountMarkdownEditor } from "./markdown-editor.js";
import { mountConfigEditor } from "./config-editor.js";
import { createPreview } from "./preview.js";
import { initToolbar } from "./toolbar.js";
import { mountMediaManager } from "./media-manager.js";
import { stopSelection } from "./selection-mode.js";
import { createLibraryBrowser, ABOUT_ME_URL_PATH } from "./library-browser.js";

function isAboutMeBlog(blog) {
    return !!blog && (blog.isAboutMe === true || blog.urlPath === ABOUT_ME_URL_PATH);
}

function makeAboutMeBlog() {
    return {
        name: ABOUT_ME_URL_PATH,
        displayName: "About Me",
        urlPath: ABOUT_ME_URL_PATH,
        isAboutMe: true,
    };
}

const mainBtn          = document.getElementById("be-main-btn");
const librariesBtn     = document.getElementById("be-libraries-btn");
const modeToggleGroup  = document.getElementById("be-mode-toggle-group");
const modeContentBtn   = document.getElementById("be-mode-content");
const modeConfigBtn    = document.getElementById("be-mode-config");
const saveBtn          = document.getElementById("be-save");
const previewToggleBtn = document.getElementById("be-preview-toggle");
const currentPathEl    = document.getElementById("be-current-path");
const libraryBrowserEl = document.getElementById("be-library-browser");
const editorViewEl     = document.getElementById("be-editor-view");
const previewViewEl    = document.getElementById("be-preview-view");
const previewContainerEl = document.getElementById("be-preview-container");
const previewIframeEl  = document.getElementById("be-preview-iframe");
const leftEl           = document.getElementById("be-left");
const toolbarEl        = document.getElementById("be-toolbar");
const tagsHelpBtn      = document.getElementById("be-tags-help-btn");
const mediaHelpBtn     = document.getElementById("be-media-help-btn");
const libraryHelpBtn   = document.getElementById("be-library-help-btn");
const mediaManagerEl   = document.getElementById("be-media-manager");
const deviceToggleGroup = document.getElementById("be-device-toggle-group");
const deviceDesktopBtn  = document.getElementById("be-device-desktop");
const deviceMobileBtn   = document.getElementById("be-device-mobile");

let libraries       = [];
let selectedBlog    = null;
let currentMode     = "content.md";
let markdownHandle  = null;
let currentJsonCore = null;
let markdownWrapEl  = null;
let configWrapEl    = null;
let _portPromise    = null;
let saveFlashTimer  = null;
let isDirty         = false;
let currentView     = "browser";

const UNSAVED_CHANGES_MESSAGE = "You have unsaved changes. Are you sure you want to leave without saving?";

function paramsFor(blog, file) {
    return `path=${encodeURIComponent(blog.urlPath)}&file=${encodeURIComponent(file)}`;
}

function flashSaveButton(ok) {
    clearTimeout(saveFlashTimer);
    saveBtn.classList.remove("be-save-btn--ok", "be-save-btn--error");
    saveBtn.classList.add(ok ? "be-save-btn--ok" : "be-save-btn--error");
    saveFlashTimer = setTimeout(() => {
        saveBtn.classList.remove("be-save-btn--ok", "be-save-btn--error");
    }, 1600);
}

function getHostingPort() {
    if (!_portPromise) {
        _portPromise = fetch("/api/config")
            .then((r) => r.json())
            .then((cfg) => cfg && cfg.hosting && cfg.hosting.port)
            .catch(() => null);
    }
    return _portPromise;
}

function parseDeepLinkUrlPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length <= 1) return null;
    return parts.slice(1).join("/");
}

function findBlogByUrlPath(urlPath) {
    for (const lib of libraries) {
        const match = lib.blogs.find((b) => b.urlPath === urlPath);
        if (match) return match;
    }
    return null;
}

function markDirty() { isDirty = true; }
function clearDirty() { isDirty = false; }

function confirmDiscardIfDirty() {
    if (!isDirty) return true;
    return window.confirm(UNSAVED_CHANGES_MESSAGE);
}

window.addEventListener("beforeunload", (e) => {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = "";
    return "";
});

function setHelpButtonsForView(view) {
    if (mediaHelpBtn)   mediaHelpBtn.hidden   = view !== "editor";
    if (tagsHelpBtn)    tagsHelpBtn.hidden    = view !== "editor";
    if (libraryHelpBtn) libraryHelpBtn.hidden = view !== "browser";
}

function showLibraryBrowserView() {
    currentView = "browser";
    libraryBrowserEl.hidden = false;
    editorViewEl.hidden = true;
    previewViewEl.hidden = true;
    previewToggleBtn.hidden = true;
    modeToggleGroup.hidden = true;
    if (deviceToggleGroup) deviceToggleGroup.hidden = true;
    saveBtn.hidden = true;
    setHelpButtonsForView("browser");
    libraryBrowser.show();
}

function showEditorView() {
    currentView = "editor";
    libraryBrowserEl.hidden = true;
    editorViewEl.hidden = false;
    previewViewEl.hidden = true;
    previewToggleBtn.hidden = false;
    modeToggleGroup.hidden = isAboutMeBlog(selectedBlog);
    saveBtn.hidden = false;
    setHelpButtonsForView("editor");
    libraryBrowser.hide();
}

const libraryBrowser = createLibraryBrowser({
    containerEl: libraryBrowserEl,
    libraryHelpBtnEl: libraryHelpBtn,
    onOpenBlog: (blog) => {
        selectBlog(blog, { pushUrl: true });
    },
    getHostingPort,
    dirty: {
        markDirty,
        clearDirty,
        confirmDiscardIfDirty,
    },
});

librariesBtn.addEventListener("click", () => {
    if (!confirmDiscardIfDirty()) return;

    selectedBlog = null;
    clearDirty();
    modeContentBtn.disabled = true;
    modeConfigBtn.disabled  = true;
    saveBtn.disabled        = true;
    previewToggleBtn.disabled = true;
    currentPathEl.textContent = "";
    currentPathEl.removeAttribute("href");

    history.pushState(null, "", "/library-explorer");
    showLibraryBrowserView();
});

function setModeButtons() {
    modeContentBtn.classList.toggle("be-toggle-btn--active", currentMode === "content.md");
    modeConfigBtn.classList.toggle("be-toggle-btn--active", currentMode === "config.json");
}

function applyModeVisibility() {
    if (markdownWrapEl) markdownWrapEl.hidden = currentMode !== "content.md";
    if (configWrapEl)   configWrapEl.hidden   = currentMode !== "config.json";
}

function switchMode(mode) {
    if (!selectedBlog || mode === currentMode) return;
    if (mode === "config.json" && isAboutMeBlog(selectedBlog)) return;
    stopSelection();
    currentMode = mode;
    setModeButtons();
    applyModeVisibility();
    if (mode === "content.md" && markdownHandle) markdownHandle.syncScroll();
}

modeContentBtn.addEventListener("click", () => switchMode("content.md"));
modeConfigBtn.addEventListener("click", () => switchMode("config.json"));

async function loadMarkdown(container, blog) {
    markdownHandle = mountMarkdownEditor(container);
    markdownHandle.textarea.addEventListener("input", markDirty);

    try {
        const res  = await fetch(`/api/blog-file?${paramsFor(blog, "content.md")}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        markdownHandle.textarea.value = data.content;
    } catch (e) {
        markdownHandle.textarea.value = "";
        markdownHandle.textarea.placeholder = `Failed to load content.md: ${e.message}`;
    }
    markdownHandle.repaint();
}

async function saveMarkdown() {
    if (!selectedBlog || !markdownHandle) return { ok: false, error: "Nothing to save" };

    const body = JSON.stringify({ content: markdownHandle.textarea.value });

    async function attempt() {
        const res = await fetch(`/api/blog-file?${paramsFor(selectedBlog, "content.md")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const text = await res.text();
        let parsed = null;
        if (text && text.trim()) {
            try { parsed = JSON.parse(text); } catch { parsed = null; }
        }
        if (!res.ok) throw new Error((parsed && parsed.error) || `HTTP ${res.status}`);
        if (parsed && parsed.error) throw new Error(parsed.error);
        return true;
    }

    try {
        await attempt();
        return { ok: true };
    } catch (firstError) {
        console.warn("Library Explorer: content.md save failed, retrying once:", firstError);
        await new Promise((r) => setTimeout(r, 600));
        try {
            await attempt();
            return { ok: true };
        } catch {
            alert(`Save failed — content.md was NOT written.\n\n${firstError.message}`);
            return { ok: false, error: firstError.message };
        }
    }
}

let _saveInFlight = false;

async function doSave() {
    if (_saveInFlight) return { ok: false, error: "Save already in progress" };
    if (currentView !== "editor" || !selectedBlog) return { ok: false, error: "Nothing selected" };

    _saveInFlight = true;
    saveBtn.disabled = true;

    let result;
    try {
        if (currentMode === "content.md") {
            result = await saveMarkdown();
        } else if (currentJsonCore) {
            result = await currentJsonCore.save();
        } else {
            result = { ok: false, error: "The config editor never loaded — reload the page." };
            alert(result.error);
        }
    } catch (e) {
        result = { ok: false, error: e.message };
        console.error("Library Explorer: unexpected save error:", e);
        alert(`Save failed unexpectedly — nothing was written.\n\n${e.message}`);
    } finally {
        _saveInFlight = false;
        saveBtn.disabled = false;
    }

    if (result && result.ok) clearDirty();
    else if (result && result.error) console.error("Library Explorer: save failed:", result.error);

    flashSaveButton(!!(result && result.ok));
    return result;
}

saveBtn.addEventListener("click", () => { doSave(); });

window.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    if (key !== "s" || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    if (currentView === "editor") {
        doSave();
        return;
    }
    const panelSave = libraryBrowserEl.querySelector("#ej-save");
    if (panelSave) panelSave.click();
});

const preview = createPreview({
    toggleBtn: previewToggleBtn,
    editorViewEl, previewViewEl,
    modeToggleGroup,
    deviceToggleGroup, deviceDesktopBtn, deviceMobileBtn,
    previewContainerEl, previewIframeEl,
    saveBtn,
    getSelectedBlog: () => selectedBlog,
    getHostingPort,
});

async function updateCurrentPathLink(blog) {
    if (!blog) {
        currentPathEl.textContent = "";
        currentPathEl.removeAttribute("href");
        return;
    }
    currentPathEl.textContent = isAboutMeBlog(blog)
        ? `public/${ABOUT_ME_URL_PATH}`
        : blog.urlPath;
    const url = await preview.buildArticleUrl(blog);
    if (url) currentPathEl.href = url;
    else currentPathEl.removeAttribute("href");
}

async function selectBlog(blog, { pushUrl = false } = {}) {
    stopSelection();

    selectedBlog = blog;
    const aboutMe = isAboutMeBlog(blog);

    modeContentBtn.disabled = false;
    modeConfigBtn.disabled  = aboutMe;
    saveBtn.disabled        = false;
    previewToggleBtn.disabled = false;
    currentMode = "content.md";
    setModeButtons();

    updateCurrentPathLink(blog);

    if (pushUrl) history.pushState(null, "", `/library-explorer/${blog.urlPath}`);

    showEditorView();

    leftEl.innerHTML = "";
    currentJsonCore = null;
    configWrapEl = null;

    markdownWrapEl = document.createElement("div");
    markdownWrapEl.className = "be-mode-wrap be-mode-wrap--markdown";
    leftEl.appendChild(markdownWrapEl);

    if (!aboutMe) {
        configWrapEl = document.createElement("div");
        configWrapEl.className = "be-mode-wrap be-mode-wrap--config";
        leftEl.appendChild(configWrapEl);
    }

    await Promise.all([
        loadMarkdown(markdownWrapEl, blog),
        aboutMe
            ? Promise.resolve(null)
            : mountConfigEditor(configWrapEl, blog, markDirty)
                .then((core) => { currentJsonCore = core; })
                .catch((e) => {
                    currentJsonCore = null;
                    console.error("Library Explorer: failed to mount config editor:", e);
                }),
    ]);

    mountMediaManager(mediaManagerEl, blog);

    clearDirty();
    applyModeVisibility();
    preview.refreshIfOn();
}

mainBtn.addEventListener("click", () => {
    if (!confirmDiscardIfDirty()) return;
    clearDirty();
    window.location.href = "/";
});

async function boot() {
    await loadBlogConfig();

    initToolbar({
        toolbarEl,
        tagsHelpBtnEl: tagsHelpBtn,
        mediaHelpBtnEl: mediaHelpBtn,
        getTextarea: () => (markdownHandle ? markdownHandle.textarea : null),
        isMarkdownMode: () => !!selectedBlog && currentMode === "content.md",
    });

    try {
        const res = await fetch("/api/blog-list");
        libraries = await res.json();
        if (!Array.isArray(libraries)) libraries = [];
    } catch (e) {
        libraries = [];
        console.error("Library Explorer: failed to load /api/blog-list:", e);
    }

    const deepLinkPath = parseDeepLinkUrlPath();
    if (deepLinkPath) {
        if (deepLinkPath === ABOUT_ME_URL_PATH) {
            await selectBlog(makeAboutMeBlog(), { pushUrl: false });
            return;
        }
        const match = findBlogByUrlPath(deepLinkPath);
        if (match) {
            await selectBlog(match, { pushUrl: false });
            return;
        }
    }

    showLibraryBrowserView();
}

boot();
