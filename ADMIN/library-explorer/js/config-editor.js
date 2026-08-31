const CONFIG_TARGET_PREFIX = "public/libraries";

function configTargetFor(blog) {
    const cleanUrlPath = String(blog.urlPath || "").replace(/^\/+|\/+$/g, "");
    return `${CONFIG_TARGET_PREFIX}/${cleanUrlPath}/config.json`;
}

async function initCore(container, blog, hooks) {
    const targetPath = configTargetFor(blog);

    console.log(`[library-explorer] config target: ${targetPath}`);

    const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
    return initJsonEditor(container, {
        target: targetPath,
        name: "Config",
        isBlogEditor: true,
        onEdit: hooks && typeof hooks.onEdit === "function" ? hooks.onEdit : null,
        onSaved: hooks && typeof hooks.onSaved === "function" ? hooks.onSaved : null,
    });
}

export async function mountConfigEditor(container, blog, onEdit) {
    container.innerHTML = `
        <h2 id="ej-title">Config</h2>
        <div id="ej-container"></div>
        <button id="ej-add" class="admin-button" type="button" hidden></button>
        <button id="ej-save" class="admin-button" type="button" hidden>Save Changes</button>
        <p id="ej-status" class="admin-status"></p>
    `;

    if (typeof onEdit === "function") {
        container.addEventListener("input", onEdit);
        container.addEventListener("change", onEdit);
    }

    return initCore(container, blog, null);
}

export async function mountBlogConfigPanel(container, blog, hooks) {
    container.innerHTML = `
        <h3 id="ej-title" class="be-lib-config-title">Config</h3>
        <div id="ej-container"></div>
        <div class="be-lib-config-actions">
            <button id="ej-add" class="admin-button" type="button" hidden></button>
            <button id="ej-save" class="admin-button" type="button">Save Changes</button>
        </div>
        <p id="ej-status" class="admin-status"></p>
    `;

    return initCore(container, blog, hooks);
}
