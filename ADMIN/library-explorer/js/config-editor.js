import { isAboutMeBlog } from "./about-me.js";

function targetFor(item, folder) {
    if (!folder && isAboutMeBlog(item)) throw new Error("About Me has no config.json");

    const urlPath = String(item.urlPath || "").replace(/^\/+|\/+$/g, "");

    if (!urlPath || urlPath.split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("Invalid configuration path");
    }

    return `public/libraries/${urlPath}/${folder ? "folder.json" : "config.json"}`;
}

async function mount(container, item, hooks = {}, folder = false, inline = false) {
    const target = targetFor(item, folder);

    container.innerHTML = `
        <h3 id="ej-title" class="be-lib-config-title"></h3>
        <div id="ej-container"></div>
        <div class="be-lib-config-actions">
            <button id="ej-add" class="admin-button" type="button" hidden></button>
            <button id="ej-save" class="admin-button" type="button" ${inline ? "" : "hidden"}>Save Changes</button>
        </div>
        <p id="ej-status" class="admin-status"></p>
    `;

    const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
    if (!container.isConnected) return null;

    return initJsonEditor(container, {
        target,
        name: folder ? "folder.json" : "config.json",
        isBlogEditor: !folder,
        onEdit: hooks?.onEdit,
        onSaved: hooks?.onSaved,
    });
}

export function mountConfigEditor(container, blog, onEdit) {
    return mount(container, blog, { onEdit });
}

export function mountBlogConfigPanel(container, blog, hooks) {
    return mount(container, blog, hooks, false, true);
}

export function mountFolderConfigPanel(container, folder, hooks) {
    return mount(container, folder, hooks, true, true);
}