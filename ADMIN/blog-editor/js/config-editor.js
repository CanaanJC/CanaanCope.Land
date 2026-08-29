// ─────────────────────────────────────────────────────────────────────────────
// Mounts the shared json.js editor core, pointed at this blog's config.json.
// isBlogEditor: true enables json.js's special "date" chip/calendar widget.
// ─────────────────────────────────────────────────────────────────────────────

export async function mountConfigEditor(container, blog, onEdit) {
    container.innerHTML = `
        <h2 id="ej-title">Config</h2>
        <div id="ej-container"></div>
        <button id="ej-add" class="admin-button" type="button" hidden></button>
        <button id="ej-save" class="admin-button" type="button" hidden>Save Changes</button>
        <p id="ej-status" class="admin-status"></p>
    `;

    container.addEventListener("input", onEdit);
    container.addEventListener("change", onEdit);

    const targetPath = `public/${blog.urlPath}/config.json`;
    const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
    return initJsonEditor(container, { target: targetPath, name: "Config", isBlogEditor: true });
}
