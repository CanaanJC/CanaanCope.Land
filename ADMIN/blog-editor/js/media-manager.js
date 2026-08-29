// ─────────────────────────────────────────────────────────────────────────────
// Blog Editor — per-article media manager. Sits below the tag toolbar, in
// the right panel. Always scoped to the CURRENTLY SELECTED blog's own
// media/ folder (and its subfolders) — never a global/site-wide browser.
//
// Features:
//   - Finder-style icon grid (folders + supported media files, folders
//     first, then natural-sort by name).
//   - Breadcrumb navigation into/out of subfolders.
//   - Upload (multi-file, filtered client-side by <input accept>, always
//     re-validated server-side).
//   - New Folder (auto-named "folderN", no dialog) — only available at the
//     media root; hidden while inside any subfolder.
//   - Rename — right-click a tile (file or folder) and choose "Rename"
//     from the context menu, then edit the name inline.
//   - Delete — right-click a tile and choose "Delete" from the context
//     menu; asks for confirmation first (folder deletes are recursive).
//   - Move — drag a FILE tile onto a folder tile (moves into it) or onto
//     a breadcrumb segment (moves up to that level). Folders themselves
//     are never draggable — folder-into-folder moves are disabled.
//   - Preview — single-click a file tile (not a folder) to open a
//     near-fullscreen viewer: images show full-size, gifs loop as a plain
//     <img> (same as anywhere else), videos get a <video controls>
//     player, and audio gets an <audio controls> player. Folders are
//     unaffected — clicking one still navigates into it. Click anywhere
//     outside the media element itself (or press Escape) to close.
//   - Media selection mode (see selection-mode.js) — when a toolbar
//     button (<STL>, <image>, <video>, <audio>, <folder>) has an active
//     selection type, matching tiles (files OR folders, depending on the
//     type's own matches() rule) highlight in that type's color; clicking
//     one hands off to the type's onPick() instead of the normal
//     click behavior (opening the viewer / navigating into a folder).
//     This file has NO hardcoded knowledge of which types exist — it
//     only ever asks the active type "does this item match?".
//
// Icon size and label text size are both driven live by the
// --media-icon-size / --media-text-size CSS variables (see
// js/blog-config.js, sourced from blog.json's "mediaDisplay" section) —
// nothing here is hardcoded to 64px/12px.
//
// Anything sitting in a "cmpsd" folder, or not matching the supported
// media whitelist, is never listed here at all — filtered server-side by
// /api/blog-media (see lib/adminRoutes.js).
// ─────────────────────────────────────────────────────────────────────────────

import { getActiveSelection, onSelectionChange, stopSelection } from "./selection-mode.js";

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "avif", "gif"]);
export const VIDEO_EXTS = new Set(["mp4", "webm"]);
export const AUDIO_EXTS = new Set(["mp3", "wav"]);

export function getExt(name) {
    return (String(name || "").split(".").pop() || "").toLowerCase();
}

const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.avif,.gif,.mp4,.webm,.mp3,.wav,.stl";

// Tracks the unsubscribe function for the PREVIOUS mountMediaManager()
// call's selection-change listener — mountMediaManager() fully rebuilds
// its container's innerHTML each time a blog is (re)selected, so without
// this the module-level listener Set in selection-mode.js would keep
// accumulating one stale listener (pointing at a detached gridEl) per
// blog switch.
let _prevSelectionUnsub = null;

// ── Media viewer (lightbox) ─────────────────────────────────────────────
// Opens a near-fullscreen overlay showing the given file according to its
// extension. Returns nothing meaningful — unsupported extensions (e.g.
// .stl) are simply not previewable and this is a silent no-op for them.
//
// No dedicated close button — clicking anywhere that ISN'T the media
// element itself (overlay background OR the box around it) closes the
// viewer, as does pressing Escape.
function openMediaViewer(name, url) {
    const ext = getExt(name);

    let mediaEl;

    if (IMAGE_EXTS.has(ext)) {
        // Plain <img> — this is exactly what makes a .gif loop, since a
        // gif's own frame-looping is intrinsic to the format/browser
        // rendering, not something this code needs to drive.
        mediaEl = document.createElement("img");
        mediaEl.src = url;
        mediaEl.alt = name;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--image";
    } else if (VIDEO_EXTS.has(ext)) {
        mediaEl = document.createElement("video");
        mediaEl.src = url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--video";
    } else if (AUDIO_EXTS.has(ext)) {
        mediaEl = document.createElement("audio");
        mediaEl.src = url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--audio";
    } else {
        // Not a previewable format (e.g. .stl) — nothing to show here.
        return;
    }

    const overlay = document.createElement("div");
    overlay.className = "be-media-viewer-overlay";

    const box = document.createElement("div");
    box.className = "be-media-viewer-box";

    box.appendChild(mediaEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Close on any click that doesn't land on the media element itself —
    // whether it's on the surrounding box (the box is intentionally
    // larger than the media so there's a comfortable click-off margin
    // all around it) or directly on the dark overlay background.
    overlay.addEventListener("click", (e) => {
        if (e.target !== mediaEl) close();
    });
    document.addEventListener("keydown", onKeydown);

    function onKeydown(e) {
        if (e.key === "Escape") close();
    }

    function close() {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
    }
}

// ── Right-click context menu — one instance at a time, closes on any
// outside click, a new right-click elsewhere, scroll, or Escape. Rendered
// at the cursor position, clamped so it never overflows the viewport. ──
let _openContextMenu = null;

function closeContextMenu() {
    if (_openContextMenu) {
        _openContextMenu.remove();
        _openContextMenu = null;
    }
    document.removeEventListener("click", closeContextMenu);
    document.removeEventListener("contextmenu", closeContextMenuOnNewRightClick);
    window.removeEventListener("scroll", closeContextMenu, true);
    document.removeEventListener("keydown", onMenuKeydown);
}

function closeContextMenuOnNewRightClick() {
    closeContextMenu();
}

function onMenuKeydown(e) {
    if (e.key === "Escape") closeContextMenu();
}

function openContextMenu(x, y, items) {
    closeContextMenu();

    const menu = document.createElement("div");
    menu.className = "be-context-menu";

    for (const { label, action, danger } of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = danger
            ? "be-context-menu-item be-context-menu-item--danger"
            : "be-context-menu-item";
        btn.textContent = label;
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            closeContextMenu();
            action();
        });
        menu.appendChild(btn);
    }

    document.body.appendChild(menu);

    // Clamp so the menu never renders off the right/bottom edge.
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, clampedX)}px`;
    menu.style.top  = `${Math.max(8, clampedY)}px`;

    _openContextMenu = menu;

    // Deferred so the very click that opened the menu doesn't immediately
    // close it via the document listener below.
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu);
        document.addEventListener("contextmenu", closeContextMenuOnNewRightClick);
        window.addEventListener("scroll", closeContextMenu, true);
        document.addEventListener("keydown", onMenuKeydown);
    }, 0);
}

export function mountMediaManager(container, blog) {
    let currentSub = ""; // "" = media/ root; otherwise e.g. "figs2" or "figs2/nested"
    let dragData = null; // { name, type, fromSub } while a drag is in progress

    // Drop any listener registered by a previous mount (see comment on
    // _prevSelectionUnsub above) before wiring this instance's own.
    if (_prevSelectionUnsub) _prevSelectionUnsub();

    container.innerHTML = `
        <div class="be-media-actions">
            <button id="be-media-upload-btn" class="admin-button" type="button">Upload</button>
            <button id="be-media-folder-btn" class="admin-button" type="button">New Folder</button>
            <input id="be-media-file-input" type="file" accept="${UPLOAD_ACCEPT}" multiple hidden />
        </div>
        <div id="be-media-breadcrumb" class="be-media-breadcrumb"></div>
        <div id="be-media-grid" class="be-media-grid"></div>
        <p id="be-media-status" class="admin-status"></p>
    `;

    const uploadBtn    = container.querySelector("#be-media-upload-btn");
    const folderBtn    = container.querySelector("#be-media-folder-btn");
    const fileInput    = container.querySelector("#be-media-file-input");
    const breadcrumbEl = container.querySelector("#be-media-breadcrumb");
    const gridEl       = container.querySelector("#be-media-grid");
    const statusEl     = container.querySelector("#be-media-status");

    function setStatus(text, kind) {
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    function fileUrl(name) {
        const subPath = currentSub ? `${currentSub}/` : "";
        const encoded = subPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
        const prefix  = encoded ? `${encoded}/` : "";
        return `/${blog.urlPath}/media/${prefix}${encodeURIComponent(name)}`;
    }

    // Path relative to the media root — what actually gets embedded in an
    // inline tag (e.g. <stl:relPath|...|...>, <relPath>, <./relPath>),
    // NOT URL-encoded.
    function relPathFor(name) {
        return currentSub ? `${currentSub}/${name}` : name;
    }

    // ── Breadcrumb ───────────────────────────────────────────────────────────

    function renderBreadcrumb() {
        breadcrumbEl.innerHTML = "";

        const rootBtn = document.createElement("button");
        rootBtn.type = "button";
        rootBtn.className = "be-media-crumb";
        rootBtn.textContent = "media";
        rootBtn.dataset.sub = "";
        rootBtn.addEventListener("click", () => { currentSub = ""; load(); });
        breadcrumbEl.appendChild(rootBtn);

        const parts = currentSub.split("/").filter(Boolean);
        let acc = "";
        for (const part of parts) {
            const sep = document.createElement("span");
            sep.className = "be-media-crumb-sep";
            sep.textContent = "/";
            breadcrumbEl.appendChild(sep);

            acc = acc ? `${acc}/${part}` : part;
            const targetSub = acc;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "be-media-crumb";
            btn.textContent = part;
            btn.dataset.sub = targetSub;
            btn.addEventListener("click", () => { currentSub = targetSub; load(); });
            breadcrumbEl.appendChild(btn);
        }

        wireBreadcrumbDropTargets();
    }

    function wireBreadcrumbDropTargets() {
        for (const crumb of breadcrumbEl.querySelectorAll(".be-media-crumb")) {
            crumb.addEventListener("dragover", (e) => {
                e.preventDefault();
                crumb.classList.add("be-media-crumb--dragover");
            });
            crumb.addEventListener("dragleave", () => {
                crumb.classList.remove("be-media-crumb--dragover");
            });
            crumb.addEventListener("drop", (e) => {
                e.preventDefault();
                crumb.classList.remove("be-media-crumb--dragover");
                if (!dragData) return;
                const toSub = crumb.dataset.sub || "";
                if (toSub === dragData.fromSub) return;
                doMove(dragData, toSub);
            });
        }
    }

    // ── New Folder button visibility — only shown at the media root;
    // hidden while inside any subfolder. ──────────────────────────────────

    function updateFolderBtnVisibility() {
        folderBtn.hidden = currentSub !== "";
    }

    // ── Tile building ─────────────────────────────────────────────────────

    function blankCard(label) {
        const card = document.createElement("div");
        card.className = "be-media-icon be-media-icon--blank";
        if (label) card.textContent = label;
        return card;
    }

    function buildIcon(item) {
        if (item.isFolder) {
            const icon = document.createElement("div");
            icon.className = "be-media-icon be-media-icon--folder";
            return icon;
        }

        const ext = getExt(item.name);
        const url = fileUrl(item.name);

        if (IMAGE_EXTS.has(ext)) {
            const img = document.createElement("img");
            img.className = "be-media-icon be-media-icon--img";
            img.src = url;
            img.alt = item.name;
            img.addEventListener("error", () => { img.replaceWith(blankCard("")); }, { once: true });
            return img;
        }

        if (VIDEO_EXTS.has(ext)) {
            const video = document.createElement("video");
            video.className = "be-media-icon be-media-icon--video";
            video.src = url;
            video.muted = true;
            video.preload = "metadata";
            video.addEventListener("error", () => { video.replaceWith(blankCard("")); }, { once: true });
            return video;
        }

        if (AUDIO_EXTS.has(ext)) return blankCard("♪");
        if (ext === "stl") return blankCard("STL");

        return blankCard("");
    }

    // Applies (or clears) the generic selection-mode highlight on a single
    // tile, based on whatever selection type (if any) is currently active.
    // Completely type-agnostic — just asks active.matches(item) (which may
    // match FILES or FOLDERS depending on the type) and uses active.color;
    // has no idea "stl"/"image"/"folder" etc. exist as concepts.
    function applyTileHighlight(tile, item) {
        const active = getActiveSelection();
        if (active && active.matches(item)) {
            tile.classList.add("be-media-tile--selectable");
            tile.style.setProperty("--select-color", active.color || "#fff");
        } else {
            tile.classList.remove("be-media-tile--selectable");
            tile.style.removeProperty("--select-color");
        }
    }

    // Re-applies highlight state to every currently-rendered tile —
    // called once right after a fresh render, and again any time the
    // active selection type changes (so toggling a button on/off updates
    // the grid live, without needing to reload from the server).
    function refreshAllHighlights() {
        for (const tile of gridEl.querySelectorAll(".be-media-tile")) {
            const item = {
                name: tile.dataset.name,
                isFolder: tile.dataset.type === "folder",
            };
            applyTileHighlight(tile, item);
        }
    }

    function buildTile(item) {
        const tile = document.createElement("div");
        tile.className = "be-media-tile";
        // Folders are never draggable — only files can be dragged to move.
        // This disables folder-into-folder moves entirely, while folders
        // can still be a DROP target for a dragged file (handled below).
        tile.draggable = !item.isFolder;
        tile.dataset.name = item.name;
        tile.dataset.type = item.isFolder ? "folder" : "file";

        const iconWrap = document.createElement("div");
        iconWrap.className = "be-media-icon-wrap";
        iconWrap.appendChild(buildIcon(item));
        tile.appendChild(iconWrap);

        const label = document.createElement("div");
        label.className = "be-media-label";
        label.textContent = item.name;
        label.title = item.name;
        tile.appendChild(label);

        applyTileHighlight(tile, item);

        // Single click:
        //   - if a selection type is active AND matches this item (file
        //     OR folder — up to that type's own matches() rule): hands
        //     off to its onPick(item, relPath) and ends selection mode,
        //     instead of the normal click behavior below.
        //   - otherwise, on a folder: navigates into it as usual.
        //   - otherwise, on a file: opens the near-fullscreen viewer.
        tile.addEventListener("click", () => {
            const active = getActiveSelection();
            if (active && active.matches(item)) {
                active.onPick(item, relPathFor(item.name));
                stopSelection();
                return;
            }

            if (item.isFolder) {
                currentSub = currentSub ? `${currentSub}/${item.name}` : item.name;
                load();
                return;
            }

            openMediaViewer(item.name, fileUrl(item.name));
        });

        // Right-click → context menu with "Rename" and "Delete" (works
        // the same for both files and folders, and the same regardless of
        // which subfolder is currently open — currentSub already scopes
        // both requests).
        tile.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, [
                {
                    label: "Rename",
                    action: () => startRename(tile, item),
                },
                {
                    label: "Delete",
                    danger: true,
                    action: () => confirmAndDelete(item),
                },
            ]);
        });

        // Drag source — files only (folders have draggable=false above,
        // so no dragstart will ever fire for them).
        if (!item.isFolder) {
            tile.addEventListener("dragstart", (e) => {
                dragData = { name: item.name, type: tile.dataset.type, fromSub: currentSub };
                tile.classList.add("be-media-tile--dragging");
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", item.name);
            });
            tile.addEventListener("dragend", () => {
                tile.classList.remove("be-media-tile--dragging");
                dragData = null;
            });
        }

        // Drop target — only folder tiles accept a drop (move a FILE into
        // them; dragData is only ever set for files now).
        if (item.isFolder) {
            tile.addEventListener("dragover", (e) => {
                e.preventDefault();
                tile.classList.add("be-media-tile--dragover");
            });
            tile.addEventListener("dragleave", () => {
                tile.classList.remove("be-media-tile--dragover");
            });
            tile.addEventListener("drop", (e) => {
                e.preventDefault();
                tile.classList.remove("be-media-tile--dragover");
                if (!dragData) return;
                if (dragData.name === item.name && dragData.fromSub === currentSub) return;
                const toSub = currentSub ? `${currentSub}/${item.name}` : item.name;
                doMove(dragData, toSub);
            });
        }

        return tile;
    }

    function startRename(tile, item) {
        const label = tile.querySelector(".be-media-label");
        if (!label) return;

        // Split the extension off for files so the user only ever edits
        // the base name — it's silently re-appended on commit, matching
        // the server's supported-extension whitelist automatically.
        let baseName = item.name;
        let ext = "";
        if (!item.isFolder) {
            const dot = item.name.lastIndexOf(".");
            if (dot > 0) {
                baseName = item.name.slice(0, dot);
                ext = item.name.slice(dot); // includes the leading "."
            }
        }

        const input = document.createElement("input");
        input.type = "text";
        input.className = "be-media-rename-input";
        input.value = baseName;
        label.replaceWith(input);
        input.focus();
        input.select();

        let settled = false;
        function commit() {
            if (settled) return;
            settled = true;
            const typed = input.value.trim();
            if (!typed) { load(); return; }
            const newName = item.isFolder ? typed : `${typed}${ext}`;
            if (newName === item.name) { load(); return; }
            doRename(item, newName);
        }

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { settled = true; load(); }
        });
        input.addEventListener("blur", commit);
    }

    function confirmAndDelete(item) {
        const confirmed = window.confirm(
            item.isFolder
                ? `Delete folder "${item.name}" and everything inside it? This cannot be undone.`
                : `Delete "${item.name}"? This cannot be undone.`
        );
        if (!confirmed) return;
        doDelete(item);
    }

    // ── Load / render grid ────────────────────────────────────────────────

    function load() {
        renderBreadcrumb();
        updateFolderBtnVisibility();
        setStatus("Loading…");

        const params = new URLSearchParams({ path: blog.urlPath, sub: currentSub });
        fetch(`/api/blog-media?${params.toString()}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error) throw new Error(data.error);

                gridEl.innerHTML = "";
                const items = [
                    ...(data.folders || []).map((name) => ({ name, isFolder: true })),
                    ...(data.files || []).map((f) => ({ name: f.name, isFolder: false })),
                ];

                if (items.length === 0) {
                    const empty = document.createElement("div");
                    empty.className = "be-media-empty";
                    empty.textContent = "This folder is empty.";
                    gridEl.appendChild(empty);
                } else {
                    for (const item of items) gridEl.appendChild(buildTile(item));
                }

                refreshAllHighlights();
                setStatus("");
            })
            .catch((e) => setStatus(`Failed to load: ${e.message}`, "error"));
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    function doRename(item, newName) {
        setStatus("Renaming…");
        const params = new URLSearchParams({ path: blog.urlPath, sub: currentSub });
        fetch(`/api/blog-media/rename?${params.toString()}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                oldName: item.name,
                newName,
                type: item.isFolder ? "folder" : "file",
            }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                load();
            })
            .catch((e) => setStatus(`Rename failed: ${e.message}`, "error"));
    }

    function doDelete(item) {
        setStatus("Deleting…");
        const params = new URLSearchParams({ path: blog.urlPath, sub: currentSub });
        fetch(`/api/blog-media/delete?${params.toString()}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: item.name,
                type: item.isFolder ? "folder" : "file",
            }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                load();
            })
            .catch((e) => setStatus(`Delete failed: ${e.message}`, "error"));
    }

    function doMove(drag, toSub) {
        setStatus("Moving…");
        fetch(`/api/blog-media/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path: blog.urlPath,
                name: drag.name,
                type: drag.type,
                fromSub: drag.fromSub,
                toSub,
            }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                load();
            })
            .catch((e) => setStatus(`Move failed: ${e.message}`, "error"));
    }

    function doUpload(file, overwrite, next) {
        setStatus(`Uploading ${file.name}…`);
        file.arrayBuffer()
            .then((buf) => {
                const params = new URLSearchParams({
                    path: blog.urlPath,
                    sub: currentSub,
                    filename: file.name,
                    overwrite: overwrite ? "true" : "false",
                });
                return fetch(`/api/blog-media/upload?${params.toString()}`, {
                    method: "POST",
                    headers: { "Content-Type": file.type || "application/octet-stream" },
                    body: buf,
                });
            })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (res.status === 409 && data.exists) {
                    if (confirm(`"${file.name}" already exists in this folder. Overwrite it?`)) {
                        doUpload(file, true, next);
                    } else {
                        next();
                    }
                    return;
                }
                if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                next();
            })
            .catch((e) => {
                setStatus(`Upload failed: ${e.message}`, "error");
                next();
            });
    }

    function uploadNext(files, index) {
        if (index >= files.length) { load(); return; }
        doUpload(files[index], false, () => uploadNext(files, index + 1));
    }

    // ── Wiring ─────────────────────────────────────────────────────────────

    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        const files = [...fileInput.files];
        fileInput.value = "";
        if (files.length === 0) return;
        uploadNext(files, 0);
    });

    folderBtn.addEventListener("click", () => {
        setStatus("Creating folder…");
        const params = new URLSearchParams({ path: blog.urlPath, sub: currentSub });
        fetch(`/api/blog-media/folder?${params.toString()}`, { method: "POST" })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                load();
            })
            .catch((e) => setStatus(`Failed to create folder: ${e.message}`, "error"));
    });

    // Live-update every tile's highlight the moment selection mode is
    // toggled on/off/switched — no reload needed, and this listener is
    // cleaned up (see _prevSelectionUnsub above) the next time a blog is
    // selected and this function runs again.
    _prevSelectionUnsub = onSelectionChange(refreshAllHighlights);

    load();
}
