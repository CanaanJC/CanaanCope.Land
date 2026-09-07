import { getActiveSelection, onSelectionChange, stopSelection } from "./selection-mode.js";

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg", "avif", "gif"]);
export const VIDEO_EXTS = new Set(["mp4", "webm"]);
export const AUDIO_EXTS = new Set(["mp3", "wav"]);

export function getExt(name) {
    return (String(name || "").split(".").pop() || "").toLowerCase();
}

const VALID_UPLOAD_EXTS = new Set([
    "png", "jpg", "jpeg", "webp", "svg", "avif", "gif",
    "mp4", "webm", "mp3", "wav", "stl",
]);

const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.avif,.gif,.mp4,.webm,.mp3,.wav,.stl";

const MIME_EXT_FALLBACK = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "model/stl": "stl",
};

let _prevSelectionUnsub = null;
let _prevPasteHandler = null;

function blankCard(label) {
    const card = document.createElement("div");
    card.className = "be-media-icon be-media-icon--blank";
    if (label) card.textContent = label;
    return card;
}

function withParam(url, key, value) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${key}=${value}`;
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function pastedFileName(file) {
    const ext = getExt(file.name) || MIME_EXT_FALLBACK[file.type] || "";
    if (file.name && getExt(file.name)) return file.name;
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    return ext ? `pasted-${stamp}.${ext}` : `pasted-${stamp}`;
}

function normalizeFile(file) {
    const name = pastedFileName(file);
    if (name === file.name) return file;
    try {
        return new File([file], name, { type: file.type });
    } catch {
        return file;
    }
}

function isValidUploadFile(file) {
    return VALID_UPLOAD_EXTS.has(getExt(file.name));
}

function attachMediaFallback(el, url) {
    let stage = 0;
    let objectUrl = null;
    let dead = false;
    let settled = false;

    function detach() {
        el.removeEventListener("error", onError);
        el.removeEventListener("load", onSuccess);
        el.removeEventListener("loadeddata", onSuccess);
    }

    function onSuccess() {
        settled = true;
        detach();
    }

    function fail() {
        if (dead) return;
        dead = true;
        detach();
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
        if (el.isConnected) el.replaceWith(blankCard(""));
    }

    function onError() {
        if (dead || settled) return;
        stage += 1;

        if (stage === 1) {
            setTimeout(() => {
                if (dead || settled || !el.isConnected) return;
                el.src = withParam(url, "_r1", Date.now());
            }, 300);
            return;
        }

        if (stage === 2) {
            fetch(withParam(url, "_r2", Date.now()), { cache: "reload" })
                .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.blob();
                })
                .then((blob) => {
                    if (dead || settled || !el.isConnected) return;
                    objectUrl = URL.createObjectURL(blob);
                    el.src = objectUrl;
                })
                .catch(() => fail());
            return;
        }

        fail();
    }

    el.addEventListener("error", onError);
    el.addEventListener("load", onSuccess);
    el.addEventListener("loadeddata", onSuccess);
}

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

    const rect = menu.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, clampedX)}px`;
    menu.style.top  = `${Math.max(8, clampedY)}px`;

    _openContextMenu = menu;

    setTimeout(() => {
        document.addEventListener("click", closeContextMenu);
        document.addEventListener("contextmenu", closeContextMenuOnNewRightClick);
        window.addEventListener("scroll", closeContextMenu, true);
        document.addEventListener("keydown", onMenuKeydown);
    }, 0);
}

function openMediaViewer(name, url) {
    const ext = getExt(name);

    let mediaEl;

    if (IMAGE_EXTS.has(ext)) {
        mediaEl = document.createElement("img");
        mediaEl.alt = name;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--image";
    } else if (VIDEO_EXTS.has(ext)) {
        mediaEl = document.createElement("video");
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--video";
    } else if (AUDIO_EXTS.has(ext)) {
        mediaEl = document.createElement("audio");
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.className = "be-media-viewer-media be-media-viewer-media--audio";
    } else {
        return;
    }

    let objectUrl = null;
    let retried = false;

    mediaEl.addEventListener("error", () => {
        if (retried) return;
        retried = true;
        fetch(withParam(url, "_v", Date.now()), { cache: "reload" })
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.blob();
            })
            .then((blob) => {
                objectUrl = URL.createObjectURL(blob);
                mediaEl.src = objectUrl;
            })
            .catch(() => {});
    });

    mediaEl.src = url;

    const overlay = document.createElement("div");
    overlay.className = "be-media-viewer-overlay";

    const box = document.createElement("div");
    box.className = "be-media-viewer-box";

    box.appendChild(mediaEl);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
        if (e.target !== mediaEl) close();
    });
    document.addEventListener("keydown", onKeydown);

    function onKeydown(e) {
        if (e.key === "Escape") close();
    }

    function close() {
        document.removeEventListener("keydown", onKeydown);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        overlay.remove();
    }
}

export function mountMediaManager(container, blog) {
    let currentSub = "";
    let dragData = null;
    let mediaVersion = Date.now();
    let dropDepth = 0;

    if (_prevSelectionUnsub) _prevSelectionUnsub();
    if (_prevPasteHandler) {
        document.removeEventListener("paste", _prevPasteHandler);
        _prevPasteHandler = null;
    }

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

    function adminMediaUrl(name) {
        return withParam(withParam(fileUrl(name), "orig", "1"), "v", mediaVersion);
    }

    function relPathFor(name) {
        return currentSub ? `${currentSub}/${name}` : name;
    }

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
                if (!dragData) return;
                e.preventDefault();
                crumb.classList.add("be-media-crumb--dragover");
            });
            crumb.addEventListener("dragleave", () => {
                crumb.classList.remove("be-media-crumb--dragover");
            });
            crumb.addEventListener("drop", (e) => {
                if (!dragData) return;
                e.preventDefault();
                e.stopPropagation();
                crumb.classList.remove("be-media-crumb--dragover");
                const toSub = crumb.dataset.sub || "";
                if (toSub === dragData.fromSub) return;
                doMove(dragData, toSub);
            });
        }
    }

    function updateFolderBtnVisibility() {
        folderBtn.hidden = currentSub !== "";
    }

    function buildIcon(item) {
        if (item.isFolder) {
            const icon = document.createElement("div");
            icon.className = "be-media-icon be-media-icon--folder";
            return icon;
        }

        const ext = getExt(item.name);
        const url = adminMediaUrl(item.name);

        if (IMAGE_EXTS.has(ext)) {
            const img = document.createElement("img");
            img.className = "be-media-icon be-media-icon--img";
            img.alt = item.name;
            img.decoding = "async";
            attachMediaFallback(img, url);
            img.src = url;
            return img;
        }

        if (VIDEO_EXTS.has(ext)) {
            const video = document.createElement("video");
            video.className = "be-media-icon be-media-icon--video";
            video.muted = true;
            video.preload = "metadata";
            attachMediaFallback(video, url);
            video.src = url;
            return video;
        }

        if (AUDIO_EXTS.has(ext)) return blankCard("♪");
        if (ext === "stl") return blankCard("STL");

        return blankCard("");
    }

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

            openMediaViewer(item.name, adminMediaUrl(item.name));
        });

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
                e.stopPropagation();
                tile.classList.remove("be-media-tile--dragover");

                const external = [...(e.dataTransfer ? e.dataTransfer.files : [])];
                if (!dragData && external.length > 0) {
                    const targetSub = currentSub ? `${currentSub}/${item.name}` : item.name;
                    handleExternalFiles(external, targetSub);
                    return;
                }

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

        let baseName = item.name;
        let ext = "";
        if (!item.isFolder) {
            const dot = item.name.lastIndexOf(".");
            if (dot > 0) {
                baseName = item.name.slice(0, dot);
                ext = item.name.slice(dot);
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

    function load() {
        mediaVersion = Date.now();
        renderBreadcrumb();
        updateFolderBtnVisibility();
        setStatus("Loading…");

        const params = new URLSearchParams({ path: blog.urlPath, sub: currentSub });
        fetch(`/api/blog-media?${params.toString()}`, { cache: "no-store" })
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
                    empty.textContent = "This folder is empty. Drop or paste files here to upload.";
                    gridEl.appendChild(empty);
                } else {
                    for (const item of items) gridEl.appendChild(buildTile(item));
                }

                refreshAllHighlights();
                setStatus("");
            })
            .catch((e) => setStatus(`Failed to load: ${e.message}`, "error"));
    }

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

    function doUpload(file, targetSub, overwrite, next) {
        setStatus(`Uploading ${file.name}…`);
        file.arrayBuffer()
            .then((buf) => {
                const params = new URLSearchParams({
                    path: blog.urlPath,
                    sub: targetSub,
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
                        doUpload(file, targetSub, true, next);
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

    function uploadNext(files, index, targetSub) {
        if (index >= files.length) { load(); return; }
        doUpload(files[index], targetSub, false, () => uploadNext(files, index + 1, targetSub));
    }

    function handleExternalFiles(rawFiles, targetSub) {
        const normalized = rawFiles.map(normalizeFile);
        const valid   = normalized.filter(isValidUploadFile);
        const skipped = normalized.length - valid.length;

        if (valid.length === 0) {
            setStatus("Nothing uploaded — unsupported file type(s).", "error");
            return;
        }
        if (skipped > 0) {
            setStatus(`Skipping ${skipped} unsupported file(s)…`);
        }

        uploadNext(valid, 0, typeof targetSub === "string" ? targetSub : currentSub);
    }

    function setDropHighlight(on) {
        container.style.outline = on ? "2px dashed #4a6a3a" : "";
        container.style.outlineOffset = on ? "-6px" : "";
    }

    container.addEventListener("dragenter", (e) => {
        if (dragData) return;
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        dropDepth += 1;
        setDropHighlight(true);
    });

    container.addEventListener("dragover", (e) => {
        if (dragData) return;
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
    });

    container.addEventListener("dragleave", () => {
        if (dragData) return;
        dropDepth = Math.max(0, dropDepth - 1);
        if (dropDepth === 0) setDropHighlight(false);
    });

    container.addEventListener("drop", (e) => {
        if (dragData) return;
        const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
        if (files.length === 0) return;
        e.preventDefault();
        dropDepth = 0;
        setDropHighlight(false);
        handleExternalFiles(files, currentSub);
    });

    function onPaste(e) {
        if (!container.isConnected || container.hidden) return;

        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
            if (!container.contains(active)) return;
        }

        const items = e.clipboardData ? [...e.clipboardData.items] : [];
        const files = items
            .filter((it) => it.kind === "file")
            .map((it) => it.getAsFile())
            .filter(Boolean);

        if (files.length === 0) return;

        e.preventDefault();
        handleExternalFiles(files, currentSub);
    }

    document.addEventListener("paste", onPaste);
    _prevPasteHandler = onPaste;

    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        const files = [...fileInput.files];
        fileInput.value = "";
        if (files.length === 0) return;
        handleExternalFiles(files, currentSub);
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

    _prevSelectionUnsub = onSelectionChange(refreshAllHighlights);

    load();
}