// ─────────────────────────────────────────────────────────────────────────────
// Mounts the shared json.js editor core, pointed at a blog's config.json.
// isBlogEditor: true enables json.js's special "date" chip/calendar widget.
//
// TWO mounters live here, both hitting the exact same core with the exact
// same target path — so they render identical field UI, both get the
// auto-injected "Raw JSON" toggle, and both save through the same
// /api/file endpoint:
//
//   mountConfigEditor()      — the split editor view's config.json pane.
//                              Its Save button is HIDDEN, because that view
//                              has a single shared Save in the top bar which
//                              calls core.save() itself.
//
//   mountBlogConfigPanel()   — the Library Browser's inline panel, shown
//                              under a selected blog's Edit / Open Live Page
//                              buttons. Its Save button is VISIBLE (json.js
//                              wires #ej-save to performSave automatically,
//                              and injects the Raw JSON toggle immediately
//                              before it), since there's no other Save
//                              anywhere on that screen.
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

// Shared path builder — both mounters must agree exactly, or the browser
// panel and the split view would end up editing different files.
function configTargetFor(blog) {
    const cleanUrlPath = String(blog.urlPath || "").replace(/^\/+|\/+$/g, "");
    return `${CONFIG_TARGET_PREFIX}/${cleanUrlPath}/config.json`;
}

async function initCore(container, blog) {
    const targetPath = configTargetFor(blog);

    // Logged so the exact target is visible in the console next to the
    // server's own resolution log — makes any future mismatch obvious
    // immediately instead of surfacing as a blank editor.
    console.log(`[library-explorer] config target: ${targetPath}`);

    const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
    return initJsonEditor(container, { target: targetPath, name: "Config", isBlogEditor: true });
}

// ── Split editor view's config.json pane ─────────────────────────────────
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

    return initCore(container, blog);
}

// ── Library Browser's inline config panel ────────────────────────────────
//
// Same markup shape as above (json.js finds its pieces by those exact ids),
// with the Save button left visible. json.js inserts its "Raw JSON" toggle
// directly before #ej-save, so the two end up side by side automatically —
// no extra layout code needed here.
//
// The heading is an <h3> rather than an <h2> because this sits underneath
// the blog's own <h3> title in the details panel; #ej-title is still the
// id json.js looks for, so it gets retitled the same way regardless of tag.
export async function mountBlogConfigPanel(container, blog) {
    container.innerHTML = `
        <h3 id="ej-title" class="be-lib-config-title">Config</h3>
        <div id="ej-container"></div>
        <div class="be-lib-config-actions">
            <button id="ej-add" class="admin-button" type="button" hidden></button>
            <button id="ej-save" class="admin-button" type="button">Save Changes</button>
        </div>
        <p id="ej-status" class="admin-status"></p>
    `;

    return initCore(container, blog);
}
