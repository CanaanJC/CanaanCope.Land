import { openMarkdownHelp } from "./toolbar.js";
import { ABOUT_ME_URL_PATH, ABOUT_ME_NAME, makeAboutMeBlog } from "./about-me.js";
import { ALL_BLOGS_ID, request, getTree, allBlogs, isPrivate } from "./browser-api.js";
import { button, text, createContextMenu } from "./browser-ui.js";
import { createActions } from "./browser-actions.js";
import { createDetails } from "./browser-details.js";
import { createDragSorting } from "./browser-drag.js";

export { ABOUT_ME_URL_PATH, ABOUT_ME_NAME };

export function createLibraryBrowser({ containerEl, libraryHelpBtnEl, onOpenBlog, getHostingPort, dirty }) {
    const state = {
        libraries: [], lib: null, sub: "", data: null, selected: null,
        move: null, busy: false, loading: false, error: "",
    };
    let loadToken = 0;
    containerEl.innerHTML = `
        <div class="be-lib-left">
            <div id="be-lib-breadcrumb" class="be-lib-breadcrumb"></div>
            <div id="be-lib-list" class="be-lib-list"></div>
        </div>
        <div class="be-lib-right">
            <div id="be-lib-actions" class="be-lib-actions"></div>
            <div id="be-lib-move-banner" class="be-lib-move-banner" hidden></div>
            <p id="be-lib-status" class="admin-status" role="status"></p>
            <div id="be-lib-details" class="be-lib-details"></div>
        </div>
    `;
    const listEl = containerEl.querySelector("#be-lib-list");
    const detailsEl = containerEl.querySelector("#be-lib-details");
    const breadcrumbEl = containerEl.querySelector("#be-lib-breadcrumb");
    const actionsEl = containerEl.querySelector("#be-lib-actions");
    const bannerEl = containerEl.querySelector("#be-lib-move-banner");
    const statusEl = containerEl.querySelector("#be-lib-status");
    const menu = createContextMenu();
    const ctx = {
        state, listEl, detailsEl, onOpenBlog, reload, render, guard, run, status,
        markDirty: () => dirty?.markDirty?.(),
        clearDirty: () => dirty?.clearDirty?.(),
        isEditing: () => details.isEditing(),
        canCreate: () => !!state.lib && !state.lib.virtual && state.data?.type === "folder" && !state.loading && !state.busy,
        async openLive(urlPath) {
            const port = await getHostingPort();
            if (!port) return;
            const encoded = urlPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
            window.open(`http://${location.hostname}:${port}/${encoded}`, "_blank", "noopener,noreferrer");
        },
    };
    const details = createDetails(ctx);
    const actions = createActions(ctx);
    const drag = createDragSorting(ctx);

    function status(message, kind = "") {
        statusEl.textContent = message;
        statusEl.className = "admin-status" + (kind ? ` admin-status--${kind}` : "");
    }

    function guard() {
        if (state.busy || state.loading) return false;
        if (dirty?.confirmDiscardIfDirty && !dirty.confirmDiscardIfDirty()) return false;
        return true;
    }

    async function run(action) {
        if (state.busy || state.loading) return;
        state.busy = true;
        containerEl.style.pointerEvents = "none";
        status("Saving…");
        try {
            await action();
            if (!state.error) status("Saved.", "ok");
        } catch (error) {
            status(error.message, "error");
        } finally {
            state.busy = false;
            containerEl.style.pointerEvents = "";
            renderList();
            renderActions();
        }
    }

    async function navigate(lib, sub = "") {
        if (!guard()) return;
        state.lib = lib;
        state.sub = sub;
        state.selected = null;
        state.data = null;
        await reload();
    }

    async function reload() {
        const token = ++loadToken;
        state.loading = true;
        state.error = "";
        render();
        try {
            const libraries = await request("/api/libraries");
            if (!Array.isArray(libraries)) throw new Error("Invalid library list");
            if (token !== loadToken) return;
            state.libraries = libraries;
            if (state.lib && !state.lib.virtual) {
                state.lib = libraries.find(lib => lib.path === state.lib.path) || null;
                if (!state.lib) { state.sub = ""; state.selected = null; }
            }
            const data = !state.lib ? null : state.lib.virtual ? await allBlogs() : await getTree(state.lib.path, state.sub);
            if (token !== loadToken) return;
            state.data = data;
            if (state.selected && !state.selected.isAboutMe) {
                state.selected = data?.items.find(item => item.urlPath === state.selected.urlPath) ||
                    (data?.type === "blog" ? data.current : null);
            }
            if (data?.type === "blog") state.selected = data.current;
        } catch (error) {
            if (token !== loadToken) return;
            state.data = null;
            state.error = error.message;
            status(error.message, "error");
        } finally {
            if (token === loadToken) {
                state.loading = false;
                render();
            }
        }
    }

    function row(item, library = false, virtual = false) {
        const el = document.createElement("div");
        el.className = "be-lib-row";
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        const selected = !library && state.selected?.urlPath === item.urlPath;
        el.classList.toggle("be-lib-row--selected", selected);
        el.classList.toggle("be-lib-row--move-flagged", !!state.move && state.move.urlPath === item.urlPath);
        const privateEntry = library ? isPrivate(item) : item.private === true;
        if (privateEntry) el.style.opacity = "0.55";
        const icon = text(el, "div", "", "be-lib-icon " + (!library && item.type === "blog" ? "be-lib-icon--blog" : "be-lib-icon--folder"));
        if (library && item.icon && !virtual) {
            const image = document.createElement("img");
            image.src = item.icon.startsWith("/") ? item.icon : `/${item.icon}`;
            image.alt = "";
            icon.classList.remove("be-lib-icon--folder");
            image.addEventListener("error", () => { image.remove(); icon.classList.add("be-lib-icon--folder"); });
            icon.appendChild(image);
        }
        const name = text(el, "div", "", "be-lib-name");
        text(name, "span", `${item.displayName || item.name || item.path}${privateEntry ? " (private)" : ""}`, "be-lib-name-inner");
        if (!virtual) text(name, "span", library ? item.path : item.urlPath, "be-lib-name-sub");
        function activate() {
            if (library) return navigate(item);
            if (item.type === "folder") return navigate(state.lib, [state.sub, item.name].filter(Boolean).join("/"));
            if (!guard()) return;
            state.selected = item;
            renderList();
            details.render();
        }
        el.addEventListener("click", activate);
        el.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); }
        });
        const items = virtual ? [] : actions.menu(item, library);
        if (items.length) el.addEventListener("contextmenu", event => menu.open(event, items));
        if (!virtual && !item.isAboutMe) drag.wire(el, item, library);
        return el;
    }

    function renderList() {
        listEl.replaceChildren();
        if (state.loading) { text(listEl, "div", "Loading…", "be-lib-empty"); return; }
        if (!state.lib) {
            listEl.appendChild(row({ path: ALL_BLOGS_ID, name: "All Blogs", virtual: true }, true, true));
            for (const library of state.libraries) listEl.appendChild(row(library, true));
            listEl.appendChild(row({ ...makeAboutMeBlog(), type: "blog" }));
            return;
        }
        if (state.error) { text(listEl, "div", state.error, "be-lib-empty"); return; }
        const items = state.data?.type === "blog" ? [state.data.current] : state.data?.items || [];
        if (!items.length) text(listEl, "div", "This folder is empty.", "be-lib-empty");
        for (const item of items) listEl.appendChild(row(item));
    }

    function renderBreadcrumb() {
        breadcrumbEl.replaceChildren();
        function crumb(label, action) {
            if (breadcrumbEl.childElementCount) text(breadcrumbEl, "span", "/", "be-lib-crumb-sep");
            const el = button(label, action);
            el.className = "be-lib-crumb";
            breadcrumbEl.appendChild(el);
        }
        crumb("Libraries", () => navigate(null));
        if (!state.lib) return;
        crumb(state.lib.name || state.lib.path, () => navigate(state.lib));
        if (state.lib.virtual) return;
        let acc = "";
        for (const part of state.sub.split("/").filter(Boolean)) {
            acc = [acc, part].filter(Boolean).join("/");
            const sub = acc;
            crumb(part, () => navigate(state.lib, sub));
        }
    }

    function renderActions() {
        actionsEl.replaceChildren(
            button("New Folder", () => actions.create("folder"), !ctx.canCreate()),
            button("New Blog", () => actions.create("blog"), !ctx.canCreate()),
            button("New Library", actions.newLibrary, state.busy || state.loading),
        );
        bannerEl.replaceChildren();
        bannerEl.hidden = !state.move;
        if (!state.move) return;
        text(bannerEl, "span", `Moving "${state.move.displayName || state.move.name}" — choose a destination folder.`);
        bannerEl.appendChild(button("Move Here", actions.moveHere, !actions.canMove()));
        bannerEl.appendChild(button("Cancel Move", () => { state.move = null; renderList(); renderActions(); }));
    }

    function render() {
        menu.close();
        renderBreadcrumb();
        renderList();
        renderActions();
        details.render();
    }

    containerEl.querySelector(".be-lib-left").addEventListener("click", event => {
        if (event.composedPath().some(node => node.matches?.(".be-lib-row, .be-lib-crumb, button, input, select, textarea, a"))) return;
        if (!state.lib || state.lib.virtual || state.data?.type !== "folder" || !state.selected) return;
        if (!guard()) return;
        state.selected = null;
        menu.close();
        renderList();
        details.render();
    });

    libraryHelpBtnEl?.addEventListener("click", () => openMarkdownHelp("/library-explorer/library.md"));

    return {
        show() {
            containerEl.hidden = false;
            reload();
        },
        hide() {
            containerEl.hidden = true;
            menu.close();
            details.reset();
            loadToken += 1;
            state.loading = false;
        },
    };
}