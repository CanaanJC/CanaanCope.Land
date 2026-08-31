import { openMarkdownHelp } from "./toolbar.js";
import { mountBlogConfigPanel } from "./config-editor.js";

export const ABOUT_ME_URL_PATH = "aboutme";
export const ABOUT_ME_NAME = "About Me";

const ALL_BLOGS_ID = "__all_blogs__";
const ALL_BLOGS_NAME = "All Blogs";

function makeAboutMeBlog() {
    return {
        name: ABOUT_ME_URL_PATH,
        displayName: ABOUT_ME_NAME,
        urlPath: ABOUT_ME_URL_PATH,
        isAboutMe: true,
    };
}

function makeAllBlogsLib() {
    return { path: ALL_BLOGS_ID, name: ALL_BLOGS_NAME, depth: 1, virtual: true };
}

function isVirtualLib(lib) {
    return !!lib && lib.virtual === true;
}

function createModal({ title, submitLabel, bodyBuilder, onSubmit }) {
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";

    const box = document.createElement("div");
    box.className = "admin-modal-box be-lib-modal-box";

    const heading = document.createElement("h3");
    heading.className = "be-lib-modal-title";
    heading.textContent = title;
    box.appendChild(heading);

    const body = document.createElement("div");
    body.className = "be-lib-modal-body";
    box.appendChild(body);
    const fields = bodyBuilder(body);

    const errorEl = document.createElement("p");
    errorEl.className = "be-lib-modal-error";
    errorEl.hidden = true;
    box.appendChild(errorEl);

    const actions = document.createElement("div");
    actions.className = "admin-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "admin-button";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", close);

    const okBtn = document.createElement("button");
    okBtn.className = "admin-button";
    okBtn.type = "button";
    okBtn.textContent = submitLabel || "Create";
    okBtn.addEventListener("click", async () => {
        errorEl.hidden = true;
        okBtn.disabled = true;
        try {
            const result = await onSubmit(fields, { setError, close });
            if (result !== false) close();
        } finally {
            okBtn.disabled = false;
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKeydown);

    function onKeydown(e) { if (e.key === "Escape") close(); }

    function setError(message) {
        errorEl.textContent = message;
        errorEl.hidden = !message;
    }

    function close() {
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
    }

    return { overlay, close, setError };
}

function addRow(body, labelText, inputEl, hintText) {
    const row = document.createElement("div");
    row.className = "be-lib-modal-row";

    const label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(inputEl);

    body.appendChild(row);

    let hint = null;
    if (hintText) {
        hint = document.createElement("p");
        hint.className = "be-lib-modal-hint";
        hint.textContent = hintText;
        body.appendChild(hint);
    }

    return { row, hint };
}

function textInput(placeholder) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "admin-field-input";
    if (placeholder) input.placeholder = placeholder;
    return input;
}

function checkboxInput(checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "admin-field-input";
    input.style.flex = "0 0 auto";
    input.checked = !!checked;
    return input;
}

function setButtonDisabled(btn, disabled, reasonTitle) {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.4" : "";
    btn.style.cursor  = disabled ? "not-allowed" : "";
    btn.title = disabled ? (reasonTitle || "") : "";
}

function naturalCompare(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

export function createLibraryBrowser({ containerEl, libraryHelpBtnEl, onOpenBlog, getHostingPort, dirty }) {
    const markDirty  = dirty && typeof dirty.markDirty === "function" ? dirty.markDirty : () => {};
    const clearDirty = dirty && typeof dirty.clearDirty === "function" ? dirty.clearDirty : () => {};
    const confirmDiscard = dirty && typeof dirty.confirmDiscardIfDirty === "function"
        ? dirty.confirmDiscardIfDirty
        : () => true;

    let libraries = [];
    let currentLib = null;
    let currentSub = "";
    let currentData = null;
    let selectedBlogItem = null;
    let moveFlag = null;
    let configMountToken = 0;

    containerEl.innerHTML = `
        <div class="be-lib-left">
            <div id="be-lib-breadcrumb" class="be-lib-breadcrumb"></div>
            <div id="be-lib-list" class="be-lib-list"></div>
        </div>
        <div class="be-lib-right">
            <div id="be-lib-actions" class="be-lib-actions"></div>
            <div id="be-lib-move-banner" class="be-lib-move-banner" hidden></div>
            <div id="be-lib-details" class="be-lib-details"></div>
        </div>
    `;

    const breadcrumbEl = containerEl.querySelector("#be-lib-breadcrumb");
    const listEl       = containerEl.querySelector("#be-lib-list");
    const actionsEl    = containerEl.querySelector("#be-lib-actions");
    const bannerEl     = containerEl.querySelector("#be-lib-move-banner");
    const detailsEl    = containerEl.querySelector("#be-lib-details");

    if (libraryHelpBtnEl) {
        libraryHelpBtnEl.addEventListener("click", () => openMarkdownHelp("/library-explorer/library.md"));
    }

    function guarded(fn) {
        return () => {
            if (!confirmDiscard()) return;
            clearDirty();
            fn();
        };
    }

    let _openMenuEl = null;

    function closeMenu() {
        if (_openMenuEl) { _openMenuEl.remove(); _openMenuEl = null; }
        document.removeEventListener("click", closeMenu);
        document.removeEventListener("contextmenu", closeMenuOnNewRightClick);
        window.removeEventListener("scroll", closeMenu, true);
        document.removeEventListener("keydown", onMenuKeydown);
    }

    function closeMenuOnNewRightClick() { closeMenu(); }
    function onMenuKeydown(e) { if (e.key === "Escape") closeMenu(); }

    function openContextMenuAt(x, y, items) {
        closeMenu();

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
                closeMenu();
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

        _openMenuEl = menu;

        setTimeout(() => {
            document.addEventListener("click", closeMenu);
            document.addEventListener("contextmenu", closeMenuOnNewRightClick);
            window.addEventListener("scroll", closeMenu, true);
            document.addEventListener("keydown", onMenuKeydown);
        }, 0);
    }

    function currentLevel() {
        return String(currentSub || "").split("/").filter(Boolean).length;
    }

    function displayLevel() {
        return currentLevel() + 1;
    }

    function isAtLeafLevel() {
        if (!currentLib || isVirtualLib(currentLib)) return false;
        return currentLevel() === currentLib.depth - 1;
    }

    function moveIsLegalHere() {
        if (!moveFlag || !currentLib) return false;
        if (isVirtualLib(currentLib)) return false;
        if (moveFlag.type === "blog") return isAtLeafLevel();
        return !isAtLeafLevel();
    }

    function libPathFor(item) {
        if (item && item.lib) return item.lib;
        return currentLib && !isVirtualLib(currentLib) ? currentLib.path : null;
    }

    function subFor(item) {
        if (item && typeof item.sub === "string") return item.sub;
        return currentSub;
    }

    function rowKeyFor(type, name, urlPath) {
        if (type === "library") return `lib:${name}`;
        if (urlPath) return `blog:${urlPath}`;
        return `${type}:${currentLib ? currentLib.path : ""}:${currentSub}:${name}`;
    }

    function findRowByKey(key) {
        const escaped = window.CSS && typeof window.CSS.escape === "function"
            ? window.CSS.escape(key)
            : key.replace(/"/g, '\\"');
        return listEl.querySelector(`.be-lib-row[data-key="${escaped}"]`);
    }

    function renderDetails() {
        detailsEl.innerHTML = "";

        if (selectedBlogItem) {
            renderBlogEditMenu();
            return;
        }

        if (!currentLib) {
            const p = document.createElement("p");
            p.className = "be-lib-details-empty";
            p.textContent = "Select a library on the left to browse its contents. Right-click a library to open its page, rename, hide or delete it.";
            detailsEl.appendChild(p);
            return;
        }

        if (isVirtualLib(currentLib)) {
            const heading = document.createElement("h3");
            heading.textContent = ALL_BLOGS_NAME;
            detailsEl.appendChild(heading);

            const countLine = document.createElement("p");
            const count = currentData && Array.isArray(currentData.items) ? currentData.items.length : 0;
            countLine.textContent = `blogs: ${count}`;
            detailsEl.appendChild(countLine);

            const note = document.createElement("p");
            note.className = "be-lib-details-note";
            note.textContent = "Virtual view — every blog from every library, at any depth. Folders and new blogs can't be created here. Right-click a blog to rename, move or delete it; moving asks you to navigate to a real library's blog level and press Move Here.";
            detailsEl.appendChild(note);
            return;
        }

        const heading = document.createElement("h3");
        heading.textContent = currentLib.name || currentLib.path;
        detailsEl.appendChild(heading);

        const pathLine = document.createElement("p");
        pathLine.textContent = `path: libraries/${currentLib.path}${currentSub ? "/" + currentSub : ""}`;
        detailsEl.appendChild(pathLine);

        const depthLine = document.createElement("p");
        depthLine.textContent = `depth: ${displayLevel()} / ${currentLib.depth} (${isAtLeafLevel() ? "blog level" : "folder level"})`;
        detailsEl.appendChild(depthLine);

        const sortLine = document.createElement("p");
        sortLine.textContent = `sorted by: ${currentLib.useDates === false ? "file name" : "blog date (newest first)"}`;
        detailsEl.appendChild(sortLine);

        const hiddenLine = document.createElement("p");
        hiddenLine.textContent = `hidden: ${currentLib.hidden === true ? "yes" : "no"}`;
        detailsEl.appendChild(hiddenLine);
    }

    function renderBlogEditMenu() {
        const mountToken = ++configMountToken;

        const heading = document.createElement("h3");
        heading.textContent = selectedBlogItem.displayName || selectedBlogItem.name;
        detailsEl.appendChild(heading);

        const pathLine = document.createElement("p");
        pathLine.textContent = selectedBlogItem.isAboutMe
            ? `public/${ABOUT_ME_URL_PATH}`
            : selectedBlogItem.urlPath;
        detailsEl.appendChild(pathLine);

        if (selectedBlogItem.isAboutMe) {
            const note = document.createElement("p");
            note.textContent = "Permanent page — cannot be renamed, moved or deleted.";
            detailsEl.appendChild(note);
        }

        const actionsWrap = document.createElement("div");
        actionsWrap.className = "be-lib-edit-menu-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "admin-button";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", guarded(() => {
            onOpenBlog({
                urlPath: selectedBlogItem.urlPath,
                name: selectedBlogItem.displayName || selectedBlogItem.name,
                isAboutMe: !!selectedBlogItem.isAboutMe,
            });
        }));
        actionsWrap.appendChild(editBtn);

        const openLiveBtn = document.createElement("button");
        openLiveBtn.type = "button";
        openLiveBtn.className = "admin-button";
        openLiveBtn.textContent = "Open Live Page";
        openLiveBtn.addEventListener("click", async () => {
            const port = await getHostingPort();
            if (!port) return;
            const url = selectedBlogItem.isAboutMe
                ? `http://${window.location.hostname}:${port}/`
                : `http://${window.location.hostname}:${port}/${selectedBlogItem.urlPath}`;
            window.open(url, "_blank", "noopener,noreferrer");
        });
        actionsWrap.appendChild(openLiveBtn);

        detailsEl.appendChild(actionsWrap);

        if (!selectedBlogItem.isAboutMe) {
            const divider = document.createElement("div");
            divider.className = "be-lib-config-divider";
            detailsEl.appendChild(divider);

            const configWrap = document.createElement("div");
            configWrap.className = "be-lib-config-panel";
            detailsEl.appendChild(configWrap);

            mountBlogConfigPanel(configWrap, {
                urlPath: selectedBlogItem.urlPath,
                name: selectedBlogItem.displayName || selectedBlogItem.name,
            }, {
                onEdit: () => { if (mountToken === configMountToken) markDirty(); },
                onSaved: () => { if (mountToken === configMountToken) clearDirty(); },
            }).catch((e) => {
                if (mountToken !== configMountToken) return;
                configWrap.innerHTML = "";
                const err = document.createElement("p");
                err.className = "admin-status admin-status--error";
                err.textContent = `Failed to load config editor: ${e.message}`;
                configWrap.appendChild(err);
            });
        }
    }

    function renderActions() {
        actionsEl.innerHTML = "";

        const virtual = isVirtualLib(currentLib);

        const newFolderBtn = document.createElement("button");
        newFolderBtn.type = "button";
        newFolderBtn.className = "admin-button";
        newFolderBtn.textContent = "New Folder";
        setButtonDisabled(
            newFolderBtn,
            !currentLib || virtual || isAtLeafLevel(),
            !currentLib
                ? "Open a library first."
                : virtual
                    ? "Folders can't be created in All Blogs."
                    : "You're at the blog level — folders can't be created here."
        );
        newFolderBtn.addEventListener("click", () => createFolder());
        actionsEl.appendChild(newFolderBtn);

        const newBlogBtn = document.createElement("button");
        newBlogBtn.type = "button";
        newBlogBtn.className = "admin-button";
        newBlogBtn.textContent = "New Blog";
        setButtonDisabled(
            newBlogBtn,
            !currentLib || virtual || !isAtLeafLevel(),
            !currentLib
                ? "Open a library first."
                : virtual
                    ? "Open a real library to create a blog."
                    : "Blogs can only be created at this library's deepest folder level."
        );
        newBlogBtn.addEventListener("click", () => openBlogModal());
        actionsEl.appendChild(newBlogBtn);

        const newLibBtn = document.createElement("button");
        newLibBtn.type = "button";
        newLibBtn.className = "admin-button";
        newLibBtn.textContent = "New Library";
        newLibBtn.addEventListener("click", () => openLibraryModal());
        actionsEl.appendChild(newLibBtn);

        renderMoveBanner();
    }

    function renderMoveBanner() {
        if (!moveFlag) {
            bannerEl.hidden = true;
            bannerEl.innerHTML = "";
            return;
        }

        bannerEl.hidden = false;
        bannerEl.innerHTML = "";

        const text = document.createElement("span");
        text.textContent = `Moving "${moveFlag.displayName || moveFlag.name}" — navigate to a destination and click Move Here.`;
        bannerEl.appendChild(text);

        const moveHereBtn = document.createElement("button");
        moveHereBtn.type = "button";
        moveHereBtn.className = "admin-button";
        moveHereBtn.textContent = "Move Here";
        setButtonDisabled(
            moveHereBtn,
            !moveIsLegalHere(),
            isVirtualLib(currentLib)
                ? "All Blogs isn't a real destination — open a library first."
                : "Not a legal destination for this item."
        );
        moveHereBtn.addEventListener("click", () => performMove());
        bannerEl.appendChild(moveHereBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "admin-button";
        cancelBtn.textContent = "Cancel Move";
        cancelBtn.addEventListener("click", () => {
            moveFlag = null;
            renderAll();
        });
        bannerEl.appendChild(cancelBtn);
    }

    function renderBreadcrumb() {
        breadcrumbEl.innerHTML = "";

        const rootBtn = document.createElement("button");
        rootBtn.type = "button";
        rootBtn.className = "be-lib-crumb";
        rootBtn.textContent = "Libraries";
        rootBtn.addEventListener("click", guarded(() => {
            currentLib = null;
            currentSub = "";
            currentData = null;
            selectedBlogItem = null;
            renderAll();
        }));
        breadcrumbEl.appendChild(rootBtn);

        if (!currentLib) return;

        const sep1 = document.createElement("span");
        sep1.className = "be-lib-crumb-sep";
        sep1.textContent = "/";
        breadcrumbEl.appendChild(sep1);

        const libBtn = document.createElement("button");
        libBtn.type = "button";
        libBtn.className = "be-lib-crumb";
        libBtn.textContent = currentLib.name || currentLib.path;
        libBtn.addEventListener("click", guarded(() => {
            currentSub = "";
            selectedBlogItem = null;
            loadLevel();
        }));
        breadcrumbEl.appendChild(libBtn);

        if (isVirtualLib(currentLib)) return;

        const parts = String(currentSub || "").split("/").filter(Boolean);
        let acc = "";
        for (const part of parts) {
            const sep = document.createElement("span");
            sep.className = "be-lib-crumb-sep";
            sep.textContent = "/";
            breadcrumbEl.appendChild(sep);

            acc = acc ? `${acc}/${part}` : part;
            const targetSub = acc;

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "be-lib-crumb";
            btn.textContent = part;
            btn.addEventListener("click", guarded(() => {
                currentSub = targetSub;
                selectedBlogItem = null;
                loadLevel();
            }));
            breadcrumbEl.appendChild(btn);
        }
    }

    function buildRow({ type, name, displayName, subLabel, urlPath, iconEl, onClick, contextItems, dimmed }) {
        const row = document.createElement("div");
        row.className = "be-lib-row";
        row.dataset.key = rowKeyFor(type, name, urlPath);

        const isSelectedBlog = type === "blog" && selectedBlogItem && (
            urlPath
                ? selectedBlogItem.urlPath === urlPath
                : selectedBlogItem.name === name
        );
        if (isSelectedBlog) row.classList.add("be-lib-row--selected");

        const isMoveFlagged = moveFlag &&
            moveFlag.name === name &&
            moveFlag.type === (type === "blog" ? "blog" : "folder") &&
            (urlPath
                ? moveFlag.urlPath === urlPath
                : (moveFlag.lib === (currentLib ? currentLib.path : null) && moveFlag.sub === currentSub));
        if (isMoveFlagged) row.classList.add("be-lib-row--move-flagged");

        if (dimmed) row.style.opacity = "0.55";

        row.appendChild(iconEl);

        const nameWrap = document.createElement("div");
        nameWrap.className = "be-lib-name";
        const nameInner = document.createElement("span");
        nameInner.className = "be-lib-name-inner";
        nameInner.textContent = displayName || name;
        nameWrap.appendChild(nameInner);

        if (subLabel) {
            const sub = document.createElement("span");
            sub.className = "be-lib-name-sub";
            sub.textContent = subLabel;
            nameWrap.appendChild(sub);
        }

        row.appendChild(nameWrap);

        row.addEventListener("click", onClick);

        if (contextItems) {
            row.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                openContextMenuAt(e.clientX, e.clientY, contextItems);
            });
        }

        return row;
    }

    function appendAllBlogsRow() {
        const icon = document.createElement("div");
        icon.className = "be-lib-icon be-lib-icon--folder";

        listEl.appendChild(buildRow({
            type: "library",
            name: ALL_BLOGS_ID,
            displayName: ALL_BLOGS_NAME,
            iconEl: icon,
            onClick: guarded(() => {
                currentLib = makeAllBlogsLib();
                currentSub = "";
                selectedBlogItem = null;
                loadLevel();
            }),
        }));
    }

    function appendAboutMeRow() {
        const icon = document.createElement("div");
        icon.className = "be-lib-icon be-lib-icon--blog";

        listEl.appendChild(buildRow({
            type: "blog",
            name: ABOUT_ME_URL_PATH,
            displayName: ABOUT_ME_NAME,
            urlPath: ABOUT_ME_URL_PATH,
            iconEl: icon,
            onClick: guarded(() => {
                selectedBlogItem = makeAboutMeBlog();
                renderList();
                renderDetails();
            }),
        }));
    }

    function openLibraryPage(lib) {
        Promise.resolve(getHostingPort()).then((port) => {
            if (!port) return;
            const url = `http://${window.location.hostname}:${port}/${lib.path}`;
            window.open(url, "_blank", "noopener,noreferrer");
        });
    }

    function renderList() {
        listEl.innerHTML = "";

        if (!currentLib) {
            appendAllBlogsRow();

            if (libraries.length === 0) {
                const empty = document.createElement("div");
                empty.className = "be-lib-empty";
                empty.textContent = "No libraries yet — create one on the right.";
                listEl.appendChild(empty);
            } else {
                for (const lib of libraries) {
                    const icon = document.createElement("div");
                    icon.className = "be-lib-icon";
                    if (lib.icon) {
                        const img = document.createElement("img");
                        img.src = lib.icon.startsWith("/") ? lib.icon : `/${lib.icon}`;
                        img.alt = "";
                        img.addEventListener("error", () => { img.remove(); icon.classList.add("be-lib-icon--folder"); });
                        icon.appendChild(img);
                    } else {
                        icon.classList.add("be-lib-icon--folder");
                    }

                    const isHidden = lib.hidden === true;

                    const contextItems = [
                        { label: "Open Library Page", action: () => openLibraryPage(lib) },
                        { label: "Rename", action: () => startRenameLibrary(lib) },
                        {
                            label: isHidden ? "Show on site" : "Hide from site",
                            action: () => setLibraryHidden(lib, !isHidden),
                        },
                        {
                            label: "Delete Library",
                            danger: true,
                            action: () => confirmAndDeleteLibrary(lib),
                        },
                    ];

                    listEl.appendChild(buildRow({
                        type: "library",
                        name: lib.path,
                        displayName: `${lib.name || lib.path}${isHidden ? "  (hidden)" : ""}`,
                        iconEl: icon,
                        dimmed: isHidden,
                        contextItems,
                        onClick: guarded(() => {
                            currentLib = lib;
                            currentSub = "";
                            selectedBlogItem = null;
                            loadLevel();
                        }),
                    }));
                }
            }

            appendAboutMeRow();
            return;
        }

        if (!currentData) return;

        if (currentData.items.length === 0) {
            const empty = document.createElement("div");
            empty.className = "be-lib-empty";
            empty.textContent = isVirtualLib(currentLib)
                ? "No blogs exist yet in any library."
                : (currentData.type === "blogs" ? "No blogs here yet." : "This folder is empty.");
            listEl.appendChild(empty);
            return;
        }

        const virtual = isVirtualLib(currentLib);

        for (const item of currentData.items) {
            const isBlog = currentData.type === "blogs";
            const icon = document.createElement("div");
            icon.className = isBlog ? "be-lib-icon be-lib-icon--blog" : "be-lib-icon be-lib-icon--folder";

            const rowType = isBlog ? "blog" : "folder";
            const contextItems = [
                { label: "Rename", action: () => startRenameFor({ ...item, type: rowType }) },
                { label: "Move", action: () => startMove({ ...item, type: rowType }) },
                { label: "Delete", danger: true, action: () => confirmAndDelete({ ...item, type: rowType }) },
            ];

            listEl.appendChild(buildRow({
                type: rowType,
                name: item.name,
                displayName: item.displayName || item.name,
                subLabel: virtual ? item.urlPath : null,
                urlPath: item.urlPath,
                iconEl: icon,
                contextItems,
                onClick: guarded(() => {
                    if (isBlog) {
                        selectedBlogItem = {
                            name: item.name,
                            displayName: item.displayName,
                            urlPath: item.urlPath,
                            lib: item.lib,
                            sub: item.sub,
                        };
                        renderList();
                        renderDetails();
                    } else {
                        currentSub = currentSub ? `${currentSub}/${item.name}` : item.name;
                        selectedBlogItem = null;
                        loadLevel();
                    }
                }),
            }));
        }
    }

    function startRenameLibrary(lib) {
        const row = findRowByKey(rowKeyFor("library", lib.path));
        if (!row) return;

        const nameWrap = row.querySelector(".be-lib-name");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "be-lib-rename-input";
        input.value = lib.name || lib.path;
        nameWrap.replaceWith(input);
        input.focus();
        input.select();

        let settled = false;
        function commit() {
            if (settled) return;
            settled = true;
            const typed = input.value.trim();
            if (!typed || typed === (lib.name || lib.path)) { renderList(); return; }

            fetch(`/api/library-fs/update-library`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: lib.path, name: typed }),
            })
                .then((r) => r.json())
                .then((res) => {
                    if (res.error) throw new Error(res.error);
                    return loadLibraries().then(renderAll);
                })
                .catch((e) => { alert(`Rename failed: ${e.message}`); renderList(); });
        }

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { settled = true; renderList(); }
        });
        input.addEventListener("blur", commit);
    }

    function setLibraryHidden(lib, hidden) {
        fetch(`/api/library-fs/update-library`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: lib.path, hidden }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                return loadLibraries().then(renderAll);
            })
            .catch((e) => alert(`Failed to update library: ${e.message}`));
    }

    function confirmAndDeleteLibrary(lib) {
        const label = lib.name || lib.path;
        const typed = window.prompt(
            `Delete the ENTIRE library "${label}"?\n\n` +
            `This permanently removes public/libraries/${lib.path}/ — every folder, ` +
            `blog and media file inside it — and its entry in libraries.json. ` +
            `This cannot be undone.\n\n` +
            `Type the library's path (${lib.path}) to confirm:`
        );

        if (typed === null) return;
        if (typed.trim() !== lib.path) {
            if (typed.trim()) alert("That didn't match the library's path — nothing was deleted.");
            return;
        }

        fetch(`/api/library-fs/delete-library`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: lib.path }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                if (res.warning) alert(res.warning);

                if (currentLib && currentLib.path === lib.path) {
                    currentLib = null;
                    currentSub = "";
                    currentData = null;
                }
                if (moveFlag && moveFlag.lib === lib.path) moveFlag = null;
                selectedBlogItem = null;

                return loadLibraries().then(renderAll);
            })
            .catch((e) => alert(`Delete failed: ${e.message}`));
    }

    function startRenameFor(item) {
        const lib = libPathFor(item);
        if (!lib) return;

        const row = findRowByKey(rowKeyFor(item.type, item.name, item.urlPath));
        if (!row) return;

        const nameWrap = row.querySelector(".be-lib-name");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "be-lib-rename-input";
        input.value = item.name;
        nameWrap.replaceWith(input);
        input.focus();
        input.select();

        let settled = false;
        function commit() {
            if (settled) return;
            settled = true;
            const typed = input.value.trim();
            if (!typed || typed === item.name) { renderList(); return; }
            fetch(`/api/library-fs/rename`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lib, sub: subFor(item), oldName: item.name, newName: typed }),
            })
                .then((r) => r.json())
                .then((res) => {
                    if (res.error) throw new Error(res.error);
                    if (selectedBlogItem && selectedBlogItem.name === item.name) selectedBlogItem = null;
                    loadLevel();
                })
                .catch((e) => { alert(`Rename failed: ${e.message}`); renderList(); });
        }

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { settled = true; renderList(); }
        });
        input.addEventListener("blur", commit);
    }

    function startMove(item) {
        const lib = libPathFor(item);
        if (!lib) return;
        moveFlag = {
            lib,
            sub: subFor(item),
            name: item.name,
            displayName: item.displayName,
            urlPath: item.urlPath,
            type: item.type === "blog" ? "blog" : "folder",
        };
        renderAll();
    }

    function performMove() {
        if (!moveFlag || !currentLib || isVirtualLib(currentLib)) return;
        fetch(`/api/library-fs/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                fromLib: moveFlag.lib,
                fromSub: moveFlag.sub,
                name: moveFlag.name,
                type: moveFlag.type,
                toLib: currentLib.path,
                toSub: currentSub,
            }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                if (selectedBlogItem && selectedBlogItem.name === moveFlag.name) selectedBlogItem = null;
                moveFlag = null;
                loadLevel();
            })
            .catch((e) => alert(`Move failed: ${e.message}`));
    }

    function confirmAndDelete(item) {
        const lib = libPathFor(item);
        if (!lib) return;
        const isBlog = item.type === "blog";
        const message = isBlog
            ? `Delete blog "${item.displayName || item.name}"? This cannot be undone.`
            : `Delete folder "${item.displayName || item.name}" and everything inside it? This cannot be undone.`;
        if (!window.confirm(message)) return;

        fetch(`/api/library-fs/delete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lib, sub: subFor(item), name: item.name, type: isBlog ? "blog" : "folder" }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                if (selectedBlogItem && selectedBlogItem.name === item.name) selectedBlogItem = null;
                loadLevel();
            })
            .catch((e) => alert(`Delete failed: ${e.message}`));
    }

    function createFolder() {
        if (!currentLib || isVirtualLib(currentLib) || isAtLeafLevel()) return;
        const name = window.prompt("New folder name:");
        if (!name || !name.trim()) return;
        fetch(`/api/library-fs/folder`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lib: currentLib.path, sub: currentSub, name: name.trim() }),
        })
            .then((r) => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                loadLevel();
            })
            .catch((e) => alert(`Failed to create folder: ${e.message}`));
    }

    function openBlogModal() {
        if (!currentLib || isVirtualLib(currentLib) || !isAtLeafLevel()) return;

        createModal({
            title: "New Blog",
            submitLabel: "Create Blog",
            bodyBuilder(body) {
                const fileInput = textInput("my-new-post");
                addRow(body, "File name:", fileInput,
                    "The folder name on disk — this is what you type into the browser URL.");

                const titleInput = textInput("My New Post");
                addRow(body, "Blog title:", titleInput,
                    "The title shown on the website. Saved as \"name\" in this blog's config.json.");

                const note = document.createElement("p");
                note.className = "be-lib-modal-note";
                note.textContent = "Both of these can be changed later — the title in config.json, the file name via right-click → Rename.";
                body.appendChild(note);

                requestAnimationFrame(() => fileInput.focus());
                return { fileInput, titleInput };
            },
            async onSubmit({ fileInput, titleInput }, { setError }) {
                const filename = fileInput.value.trim();
                const title    = titleInput.value.trim();

                if (!filename) { setError("Please enter a file name."); return false; }
                if (!title)    { setError("Please enter a blog title."); return false; }

                try {
                    const res = await fetch(`/api/library-fs/new-blog`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lib: currentLib.path, sub: currentSub, filename, title }),
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    loadLevel();
                    return true;
                } catch (e) {
                    setError(`Failed to create blog: ${e.message}`);
                    return false;
                }
            },
        });
    }

    function openLibraryModal() {
        createModal({
            title: "New Library",
            submitLabel: "Create Library",
            bodyBuilder(body) {
                const pathInput = textInput("my-library");
                addRow(body, "Path:", pathInput,
                    "This is the thing you type into the browser URL. Also used as the library's id.");

                const nameInput = textInput("My Library");
                addRow(body, "Name:", nameInput,
                    "This is what is shown on the website.");

                const depthInput = document.createElement("input");
                depthInput.type = "number";
                depthInput.min = "1";
                depthInput.step = "1";
                depthInput.value = "1";
                depthInput.className = "admin-field-input";
                addRow(body, "Depth:", depthInput,
                    "How many folder levels deep the blogs sit. Whole numbers above 0.");

                const iconWrap = document.createElement("div");
                iconWrap.className = "be-lib-modal-icon-wrap";

                const iconPreview = document.createElement("div");
                iconPreview.className = "be-lib-modal-icon-preview";

                const iconBtn = document.createElement("button");
                iconBtn.type = "button";
                iconBtn.className = "admin-button";
                iconBtn.textContent = "Choose Icon…";

                const iconFile = document.createElement("input");
                iconFile.type = "file";
                iconFile.accept = "image/png";
                iconFile.hidden = true;

                iconWrap.appendChild(iconPreview);
                iconWrap.appendChild(iconBtn);
                iconWrap.appendChild(iconFile);

                addRow(body, "Icon:", iconWrap,
                    "Optional PNG shown next to the library. Uploaded to media/libraries/ when the library is created.");

                let pickedFile = null;
                iconBtn.addEventListener("click", () => iconFile.click());
                iconFile.addEventListener("change", () => {
                    pickedFile = iconFile.files[0] || null;
                    iconPreview.innerHTML = "";
                    if (pickedFile) {
                        const img = document.createElement("img");
                        img.src = URL.createObjectURL(pickedFile);
                        img.alt = "";
                        iconPreview.appendChild(img);
                        iconBtn.textContent = "Change Icon";
                    } else {
                        iconBtn.textContent = "Choose Icon…";
                    }
                });

                const sortToggle = checkboxInput(true);
                const sortRow = addRow(body, "Sort by blog date:", sortToggle,
                    "On = newest blog date first (undated blogs after, by file name). Off = sort purely by file name.");

                const SORT_HINT_ENABLED = "On = newest blog date first (undated blogs after, by file name). Off = sort purely by file name.";
                const SORT_HINT_DISABLED = "Unavailable for multi-level libraries — dates can only sort at a single blog level.";

                function applyDepthRules() {
                    const depth = parseInt(depthInput.value, 10);
                    const multiLevel = Number.isFinite(depth) && depth > 1;

                    sortToggle.disabled = multiLevel;
                    sortRow.row.classList.toggle("be-lib-modal-row--disabled", multiLevel);
                    if (sortRow.hint) {
                        sortRow.hint.textContent = multiLevel ? SORT_HINT_DISABLED : SORT_HINT_ENABLED;
                        sortRow.hint.classList.toggle("be-lib-modal-hint--disabled", multiLevel);
                    }
                    sortToggle.title = multiLevel ? SORT_HINT_DISABLED : "";
                    sortToggle.checked = !multiLevel;
                }

                depthInput.addEventListener("input", applyDepthRules);
                depthInput.addEventListener("change", applyDepthRules);
                applyDepthRules();

                const hiddenToggle = checkboxInput(false);
                addRow(body, "Hidden:", hiddenToggle,
                    "Off by default. On = the library still exists and is reachable by URL, but isn't listed publicly. Toggle later by right-clicking the library.");

                const note = document.createElement("p");
                note.className = "be-lib-modal-note";
                note.textContent = "These settings can be changed later in the admin portal.";
                body.appendChild(note);

                requestAnimationFrame(() => pathInput.focus());

                return { pathInput, nameInput, depthInput, sortToggle, hiddenToggle, getIconFile: () => pickedFile };
            },
            async onSubmit({ pathInput, nameInput, depthInput, sortToggle, hiddenToggle, getIconFile }, { setError }) {
                const libPath = pathInput.value.trim();
                const name    = nameInput.value.trim();
                const depth   = parseInt(depthInput.value, 10);

                if (!libPath) { setError("Please enter a path."); return false; }
                if (!name)    { setError("Please enter a name."); return false; }
                if (libPath.toLowerCase() === ABOUT_ME_URL_PATH) {
                    setError(`"${ABOUT_ME_URL_PATH}" is a reserved path used by the About Me page.`);
                    return false;
                }
                if (!Number.isFinite(depth) || depth < 1 || !Number.isInteger(depth)) {
                    setError("Depth must be a whole number greater than 0.");
                    return false;
                }

                const useDates = depth > 1 ? false : sortToggle.checked;

                let iconPath = "";
                const file = getIconFile();
                if (file) {
                    try {
                        const buf = await file.arrayBuffer();
                        const params = new URLSearchParams({ name: libPath, overwrite: "true" });
                        const iconRes = await fetch(`/api/upload/library?${params.toString()}`, {
                            method: "POST",
                            headers: { "Content-Type": file.type || "application/octet-stream" },
                            body: buf,
                        });
                        const iconData = await iconRes.json();
                        if (!iconRes.ok || iconData.error) throw new Error(iconData.error || `HTTP ${iconRes.status}`);
                        iconPath = iconData.path || "";
                    } catch (e) {
                        setError(`Icon upload failed: ${e.message}`);
                        return false;
                    }
                }

                try {
                    const res = await fetch(`/api/library-fs/new-library`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            path: libPath,
                            name,
                            depth,
                            useDates,
                            hidden: hiddenToggle.checked,
                            icon: iconPath,
                        }),
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);

                    await loadLibraries();
                    const created = libraries.find((l) => l.path === data.library.path);
                    if (created) {
                        currentLib = created;
                        currentSub = "";
                        selectedBlogItem = null;
                        loadLevel();
                    } else {
                        renderAll();
                    }
                    return true;
                } catch (e) {
                    setError(`Failed to create library: ${e.message}`);
                    return false;
                }
            },
        });
    }

    function loadLibraries() {
        return fetch("/api/libraries")
            .then((r) => r.json())
            .then((data) => { libraries = Array.isArray(data) ? data : []; })
            .catch(() => { libraries = []; });
    }

    function loadAllBlogs() {
        return fetch("/api/blog-list")
            .then((r) => r.json())
            .then((data) => {
                const libs = Array.isArray(data) ? data : [];
                const items = [];
                for (const lib of libs) {
                    for (const blog of (lib.blogs || [])) {
                        const parts = String(blog.urlPath || "").split("/").filter(Boolean);
                        if (parts.length < 2) continue;
                        items.push({
                            name: parts[parts.length - 1],
                            displayName: blog.name || parts[parts.length - 1],
                            urlPath: blog.urlPath,
                            lib: parts[0],
                            sub: parts.slice(1, -1).join("/"),
                        });
                    }
                }
                items.sort((a, b) => naturalCompare(a.displayName, b.displayName));
                currentData = { type: "blogs", items, virtual: true };
            })
            .catch((e) => {
                currentData = { type: "blogs", items: [], virtual: true };
                console.error("Library Browser: failed to load all blogs:", e);
            });
    }

    function loadLevel() {
        if (!currentLib) { renderAll(); return; }

        if (isVirtualLib(currentLib)) {
            loadAllBlogs().then(renderAll);
            return;
        }

        const params = new URLSearchParams({ lib: currentLib.path, sub: currentSub });
        fetch(`/api/library-tree?${params.toString()}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error) throw new Error(data.error);
                currentData = data;
                renderAll();
            })
            .catch((e) => {
                currentData = { type: "folders", items: [] };
                renderAll();
                console.error("Library Browser: failed to load level:", e);
            });
    }

    function renderAll() {
        renderBreadcrumb();
        renderList();
        renderActions();
        renderDetails();
    }

    let loaded = false;

    function show() {
        containerEl.hidden = false;
        if (!loaded) {
            loaded = true;
            loadLibraries().then(renderAll);
        } else {
            renderAll();
        }
    }

    function hide() {
        containerEl.hidden = true;
        closeMenu();
    }

    return { show, hide };
}
