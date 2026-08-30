// ─────────────────────────────────────────────────────────────────────────────
// Mounts the shared json.js editor core, pointed at this blog's config.json.
// isBlogEditor: true enables json.js's special "date" chip/calendar widget.
//
// blog.urlPath is LIBRARY-relative (e.g. "template/K1SE_MC_Mod"), but on
// disk every library lives under public/libraries/. The target below must
// therefore include that "libraries" segment — exactly how
// lib/adminRoutes/blogRoutes.js resolves content.md. Building it as
// `public/<urlPath>/config.json` points at a file that doesn't exist, so
// /api/file 404s and the editor renders an empty/null document.
//
// NOTE: this is an ES module loaded by the browser. After editing it, do a
// hard reload (Ctrl/Cmd+Shift+R) — a cached copy of the old module will
// keep requesting the old path even though the file on disk is correct.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_TARGET_PREFIX = "public/libraries";

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

    const cleanUrlPath = String(blog.urlPath || "").replace(/^\/+|\/+$/g, "");
    const targetPath = `${CONFIG_TARGET_PREFIX}/${cleanUrlPath}/config.json`;

    // Logged so the exact target is visible in the console next to the
    // server's own resolution log — makes any future mismatch obvious
    // immediately instead of surfacing as a blank editor.
    console.log(`[library-explorer] config target: ${targetPath}`);

    const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
    return initJsonEditor(container, { target: targetPath, name: "Config", isBlogEditor: true });
}
