// ─────────────────────────────────────────────────────────────────────────────
// Library Explorer — main orchestrator. See css/*.css for layout/styling, and
// the sibling js/ modules for the individual pieces (preview, config editor,
// markdown editor + tag syntax highlighting, right-panel toolbar, media
// manager, media selection mode, library browser).
//
// Two top-level views share .be-main: the full-page Library Browser (the
// default view — shown whenever no blog is being edited) and the split
// editor view (plus its own full-bleed preview sub-view). A blog is opened
// either via a deep-linked URL on load, or by clicking it in the Library
// Browser and pressing its "Edit" button. The "Libraries" top-bar button
// always returns to the browser.
//
// ── SPECIAL CASE: the About Me page (public/aboutme/) ─────────────────────
// It's pinned to the BOTTOM of the Library Browser's library list and
// edited here with the exact same markdown editor + media manager as any
// blog. But it is NOT a library blog:
//   - it has no config.json, so the content.md ⇄ config.json mode toggle is
//     hidden entirely while it's open and only content.md is editable;
//   - it never appears in /api/blog-list, so the deep link
//     /library-explorer/aboutme is resolved explicitly in boot();
//   - it can never be deleted/renamed/moved (the Library Browser gives its
//     row no context menu at all);
//   - its "live page" is the site root, not /aboutme (see preview.js).
//
// ABOUT_ME_URL_PATH is imported from library-browser.js and the tiny
// isAboutMeBlog()/makeAboutMeBlog() helpers are declared inline rather than
// living in their own module: adminServer.js serves index.html for any
// non-existent path under /library-explorer/, so a missing or mistyped
// module filename silently returns HTML and kills this whole module graph
// with a MIME-type error instead of an honest 404.
//
// Unsaved-changes protection: any edit in either mounted editor marks the
// page dirty; switching blogs / leaving the page / returning to the
// Library Browser warns before discarding. Switching content.md ⇄
// config.json or toggling preview never discards anything — both editors
// stay mounted the whole time. The media manager and the Library Browser
// are both independent of dirty-tracking — every action either of them
// takes writes to disk immediately on its own.
//
// Any active media-selection mode (e.g. <STL>/<image>/<video>/<audio>/
// <folder> picking) is cancelled whenever the edit mode is switched away
// from content.md, or a different blog is selected — it should never
// persist across either.
// ─────────────────────────────────────────────────────────────────────────────

import { loadBlogConfig } from "./library-config.js";
import { mountMarkdownEditor } from "./markdown-editor.js";
import { mountConfigEditor } from "./config-editor.js";
import { createPreview } from "./preview.js";
import { initToolbar } from "./toolbar.js";
import { mountMediaManager } from "./media-manager.js";
import { stopSelection } from "./selection-mode.js";
import { createLibraryBrowser, ABOUT_ME_URL_PATH } from "./library-browser.js";

// ── About Me helpers (inlined — see the note in the header comment) ─────────

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
let markdownHandle  = null; // { textarea, repaint, syncScroll }
let currentJsonCore = null;
let markdownWrapEl  = null;
let configWrapEl    = null;
let _portPromise    = null;
let saveFlashTimer  = null;
let isDirty         = false;
let currentView     = "browser"; // "browser" | "editor"

const UNSAVED_CHANGES_MESSAGE = "You have unsaved changes. Are you sure you want to leave without saving?";

function applyTheme(theme) {
    const root = document.documentElement;
    if (!theme) return;
    if (theme.master?.backgroundColor) root.style.setProperty("--admin-bg", theme.master.backgroundColor);
    if (theme.master?.textColor)       root.style.setProperty("--admin-text", theme.master.textColor);
    if (theme.topbar?.backgroundColor) root.style.setProperty("--admin-panel-bg", theme.topbar.backgroundColor);
}

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

// ── Unsaved-changes tracking ─────────────────────────────────────────────────

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

// ── View switching (Library Browser / editor) ────────────────────────────────

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
    // The About Me page has no config.json — hide the whole mode toggle
    // rather than offering a mode that can't exist.
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
});

librariesBtn.addEventListener("click", () => {
    if (currentView === "editor" && !confirmDiscardIfDirty()) return;

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

// ── Mode toggle (content.md ⇄ config.json) — purely visual ─────────────────

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
    // No config.json exists for the About Me page — refuse the switch
    // outright (the toggle is hidden anyway; this is belt-and-braces).
    if (mode === "config.json" && isAboutMeBlog(selectedBlog)) return;
    // A media-selection pick (e.g. <STL>/<image>/etc.) only ever makes
    // sense while content.md is the active mode — cancel it on any mode
    // switch so it can never linger while editing config.json.
    stopSelection();
    currentMode = mode;
    setModeButtons();
    applyModeVisibility();
    if (mode === "content.md" && markdownHandle) markdownHandle.syncScroll();
}

modeContentBtn.addEventListener("click", () => switchMode("content.md"));
modeConfigBtn.addEventListener("click", () => switchMode("config.json"));

// ── content.md load/save ─────────────────────────────────────────────────────

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
    try {
        const res = await fetch(`/api/blog-file?${paramsFor(selectedBlog, "content.md")}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: markdownHandle.textarea.value }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Save button ──────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
    if (!selectedBlog || preview.isOn()) return;
    let result;
    if (currentMode === "content.md") {
        result = await saveMarkdown();
    } else if (currentJsonCore) {
        result = await currentJsonCore.save();
    } else {
        result = { ok: false };
    }
    if (result && result.ok) clearDirty();
    flashSaveButton(!!(result && result.ok));
});

// ── Preview ──────────────────────────────────────────────────────────────────

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


// ── Top-right "current path" link ────────────────────────────────────────────

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

// ── Blog selection ───────────────────────────────────────────────────────────

async function selectBlog(blog, { pushUrl = false } = {}) {
    // Any active media-selection pick is scoped to a single blog's media
    // manager — cancel it before switching to a different one.
    stopSelection();

    selectedBlog = blog;
    const aboutMe = isAboutMeBlog(blog);

    modeContentBtn.disabled = false;
    modeConfigBtn.disabled  = aboutMe; // no config.json exists for About Me
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

    // Only real library blogs get a config.json pane mounted at all.
    if (!aboutMe) {
        configWrapEl = document.createElement("div");
        configWrapEl.className = "be-mode-wrap be-mode-wrap--config";
        leftEl.appendChild(configWrapEl);
    }

    await Promise.all([
        loadMarkdown(markdownWrapEl, blog),
        aboutMe
            ? Promise.resolve(null)
            : mountConfigEditor(configWrapEl, blog, markDirty).then((core) => { currentJsonCore = core; }),
    ]);

    // Media manager re-mounts fresh every time the selected blog changes —
    // always points at THIS blog's own media/ folder, always starts back at
    // the root of it. For About Me that's public/aboutme/media/, resolved
    // server-side (see lib/adminRoutes/blogMediaRoutes.js).
    mountMediaManager(mediaManagerEl, blog);

    clearDirty();
    applyModeVisibility();
    preview.refreshIfOn();
}

// ── Main button ──────────────────────────────────────────────────────────────

mainBtn.addEventListener("click", () => {
    if (!confirmDiscardIfDirty()) return;
    window.location.href = "/";
});

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
    // library.json must be loaded BEFORE the toolbar is initialized, since
    // toolbar.js's button text colors / STL defaults are pulled live from
    // it rather than ever being hardcoded (this also injects
    // --lib-sidebar-width for the Library Browser).
    await loadBlogConfig();

    initToolbar({
        toolbarEl,
        tagsHelpBtnEl: tagsHelpBtn,
        mediaHelpBtnEl: mediaHelpBtn,
        getTextarea: () => (markdownHandle ? markdownHandle.textarea : null),
        isMarkdownMode: () => !!selectedBlog && currentMode === "content.md",
    });

    fetch("/api/config")
        .then((r) => r.json())
        .then((cfg) => applyTheme(cfg && cfg.theme))
        .catch(() => {});

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
        // /library-explorer/aboutme is a valid deep link even though the
        // About Me page never appears in /api/blog-list.
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

    // No valid deep-linked blog — start on the Library Browser.
    showLibraryBrowserView();
}

boot();
