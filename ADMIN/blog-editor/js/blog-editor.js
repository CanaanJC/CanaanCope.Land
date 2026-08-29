// ─────────────────────────────────────────────────────────────────────────────
// Blog Editor — main orchestrator. See css/blog-editor-*.css for
// layout/styling, and the sibling js/ modules for the individual pieces
// (dropdown, preview, config editor, markdown editor + tag syntax
// highlighting, right-panel toolbar, media manager, media selection mode).
//
// Unsaved-changes protection: any edit in either mounted editor marks the
// page dirty; switching blogs / leaving the page warns before discarding.
// Switching content.md ⇄ config.json or toggling preview never discards
// anything — both editors stay mounted the whole time. The media manager
// is independent of dirty-tracking — every media action (upload, new
// folder, rename, move) writes to disk immediately on its own.
//
// Any active media-selection mode (e.g. <STL>/<image>/<video>/<audio>/
// <folder> picking) is cancelled whenever the edit mode is switched away
// from content.md, or a different blog is selected — it should never
// persist across either.
// ─────────────────────────────────────────────────────────────────────────────

import { loadBlogConfig } from "./blog-config.js";
import { mountMarkdownEditor } from "./markdown-editor.js";
import { mountConfigEditor } from "./config-editor.js";
import { createDropdown } from "./dropdown.js";
import { createPreview } from "./preview.js";
import { initToolbar } from "./toolbar.js";
import { mountMediaManager } from "./media-manager.js";
import { stopSelection } from "./selection-mode.js";

const mainBtn          = document.getElementById("be-main-btn");
const modeToggleGroup  = document.getElementById("be-mode-toggle-group");
const modeContentBtn   = document.getElementById("be-mode-content");
const modeConfigBtn    = document.getElementById("be-mode-config");
const saveBtn          = document.getElementById("be-save");
const previewToggleBtn = document.getElementById("be-preview-toggle");
const currentPathEl    = document.getElementById("be-current-path");
const editorViewEl     = document.getElementById("be-editor-view");
const previewViewEl    = document.getElementById("be-preview-view");
const previewContainerEl = document.getElementById("be-preview-container");
const previewIframeEl  = document.getElementById("be-preview-iframe");
const leftEl           = document.getElementById("be-left");
const toolbarEl        = document.getElementById("be-toolbar");
const tagsHelpBtn      = document.getElementById("be-tags-help-btn");
const mediaHelpBtn     = document.getElementById("be-media-help-btn");
const mediaManagerEl   = document.getElementById("be-media-manager");

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

// ── Dropdown ─────────────────────────────────────────────────────────────────

const dropdown = createDropdown({
    btn: document.getElementById("be-dropdown-btn"),
    panel: document.getElementById("be-dropdown-panel"),
    onSelect: (blog) => {
        if (blog.urlPath !== selectedBlog?.urlPath && !confirmDiscardIfDirty()) return;
        selectBlog(blog, { pushUrl: true });
    },
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
    currentPathEl.textContent = blog.urlPath;
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
    document.getElementById("be-dropdown-btn").textContent = `${blog.name} ▾`;
    modeContentBtn.disabled = false;
    modeConfigBtn.disabled  = false;
    saveBtn.disabled        = false;
    previewToggleBtn.disabled = false;
    currentMode = "content.md";
    setModeButtons();

    updateCurrentPathLink(blog);

    if (pushUrl) history.pushState(null, "", `/blog-editor/${blog.urlPath}`);

    dropdown.render(libraries, selectedBlog);

    leftEl.innerHTML = "";

    markdownWrapEl = document.createElement("div");
    markdownWrapEl.className = "be-mode-wrap be-mode-wrap--markdown";
    leftEl.appendChild(markdownWrapEl);

    configWrapEl = document.createElement("div");
    configWrapEl.className = "be-mode-wrap be-mode-wrap--config";
    leftEl.appendChild(configWrapEl);

    await Promise.all([
        loadMarkdown(markdownWrapEl, blog),
        mountConfigEditor(configWrapEl, blog, markDirty).then((core) => { currentJsonCore = core; }),
    ]);

    // Media manager re-mounts fresh every time the selected blog changes —
    // always points at THIS blog's own media/ folder, always starts back
    // at the root of it.
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
    // blog.json must be loaded BEFORE the toolbar is initialized, since
    // toolbar.js's button text colors / STL defaults are pulled live from
    // it rather than ever being hardcoded.
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
        console.error("Blog Editor: failed to load /api/blog-list:", e);
    }

    dropdown.render(libraries, selectedBlog);

    const deepLinkPath = parseDeepLinkUrlPath();
    if (deepLinkPath) {
        const match = findBlogByUrlPath(deepLinkPath);
        if (match) await selectBlog(match, { pushUrl: false });
    }
}

boot();
