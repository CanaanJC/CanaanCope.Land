// ─────────────────────────────────────────────────────────────────────────────
// Generic JSON-file field editor.
//
// This element edits whatever file its sibling config.json points to (the
// "target" path, relative to node.js's project root — e.g. "config/master.json").
// Its sibling config.json can also set a "name" — if non-empty, that string
// is displayed as the panel's title (and therefore in the admin panel-nav
// menu too, since that reads the rendered <h2>) instead of the raw target
// path. Leave "name" blank to keep showing the path.
//
// To make a new editor for another JSON file: copy this whole folder, give
// it a new name, and edit its config.json's "target" (and optionally
// "name"). No JS edits needed.
// ─────────────────────────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Auto-grows a textarea's height to fit its content (wraps instead of
// scrolling/truncating), so long values push the box taller rather than
// overflowing or hiding text.
function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// Sizes the textarea now AND keeps re-sizing it whenever its actual
// rendered width changes. This matters because admin.js builds columns one
// at a time — a textarea can get its initial height measured while its
// column is still temporarily full-width (before sibling columns exist),
// then get squeezed narrower afterward, needing more wrapped lines than
// the already-fixed height allows. Watching width (not height) avoids a
// feedback loop, since only a width change ever requires a re-measure.
function attachAutoGrow(textarea) {
    let lastWidth = null;

    const resize = () => autoGrow(textarea);

    requestAnimationFrame(resize);

    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const width = entry.contentRect.width;
            if (width !== lastWidth) {
                lastWidth = width;
                resize();
            }
        }
    });
    observer.observe(textarea);
}

function makeLeafInput(value, onChange) {
    if (typeof value === "boolean") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = value;
        input.className = "admin-field-input";
        input.style.flex = "0 0 auto";
        input.addEventListener("change", () => onChange(input.checked));
        return input;
    }

    if (typeof value === "number") {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "admin-field-input";
        input.value = value;
        input.addEventListener("input", () => onChange(input.valueAsNumber));
        return input;
    }

    // String (default) — a wrapping, auto-growing textarea instead of a
    // single-line input, so long text wraps onto additional lines /
    // increases box height instead of being clipped. Hex colors still get
    // a paired native color picker alongside it. Uses .admin-field-value-wrap
    // (min-width: 0 + flex-wrap) so it collapses onto its own line rather
    // than forcing the column wider than the viewport.
    const wrap = document.createElement("div");
    wrap.className = "admin-field-value-wrap";

    const text = document.createElement("textarea");
    text.className = "admin-field-input-text";
    text.rows = 1;
    text.value = value ?? "";

    const handleResize = () => autoGrow(text);

    if (HEX_RE.test(value || "")) {
        const color = document.createElement("input");
        color.type = "color";
        color.className = "admin-field-color";
        color.value = value.length === 4
            ? `#${[...value.slice(1)].map(c => c + c).join("")}`
            : value;

        color.addEventListener("input", () => {
            text.value = color.value;
            onChange(color.value);
        });
        text.addEventListener("input", () => {
            onChange(text.value);
            if (HEX_RE.test(text.value)) color.value = text.value;
            handleResize();
        });

        wrap.appendChild(color);
        wrap.appendChild(text);
    } else {
        text.addEventListener("input", () => {
            onChange(text.value);
            handleResize();
        });
        wrap.appendChild(text);
    }

    // Initial sizing + ongoing re-sizing whenever the textarea's own width
    // changes (see attachAutoGrow's comment for why this is necessary).
    attachAutoGrow(text);

    return wrap;
}

// Array editor — one line per top-level array item (each rendered as
// compact JSON via JSON.stringify), in a wrapping/auto-growing textarea so
// long items wrap onto extra lines instead of scrolling off-screen or
// getting clipped to a single line. Re-parses on every keystroke; a line
// that isn't valid JSON just flags the box red (via .admin-field-input-text--error)
// without losing what you typed or touching the underlying data until it's
// valid again.
function makeArrayInput(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "admin-field-value-wrap";

    const text = document.createElement("textarea");
    text.className = "admin-field-input-text";
    text.rows = 1;
    text.value = value.map(item => JSON.stringify(item)).join("\n");

    const handleResize = () => autoGrow(text);

    text.addEventListener("input", () => {
        const lines = text.value.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        try {
            const parsed = lines.map(l => JSON.parse(l));
            onChange(parsed);
            text.classList.remove("admin-field-input-text--error");
            text.title = "";
        } catch (e) {
            text.classList.add("admin-field-input-text--error");
            text.title = `Invalid JSON on one of the lines: ${e.message}`;
        }
        handleResize();
    });

    attachAutoGrow(text);

    wrap.appendChild(text);
    return wrap;
}

function renderObject(obj, container, pathPrefix, data) {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;

        if (value && typeof value === "object" && !Array.isArray(value)) {
            const fieldset = document.createElement("fieldset");
            fieldset.className = "admin-fieldset";
            const legend = document.createElement("legend");
            legend.textContent = key;
            fieldset.appendChild(legend);
            container.appendChild(fieldset);
            renderObject(value, fieldset, fullPath, data);
            continue;
        }

        const row = document.createElement("div");
        row.className = "admin-field-row";

        const label = document.createElement("label");
        label.className = "admin-field-label";
        label.textContent = key;
        row.appendChild(label);

        const setAtPath = (v) => {
            const segments = fullPath.split(".");
            let node = data;
            for (let i = 0; i < segments.length - 1; i++) node = node[segments[i]];
            node[segments[segments.length - 1]] = v;
        };

        if (Array.isArray(value)) {
            row.appendChild(makeArrayInput(value, setAtPath));
            container.appendChild(row);
            continue;
        }

        row.appendChild(makeLeafInput(value, setAtPath));
        container.appendChild(row);
    }
}

// `elementConfig` is this element's own sibling config.json, loaded and
// passed in by admin.js — { "target": "config/master.json", "name": "" }.
export default function init(root, elementConfig) {
    const fieldsEl = root.querySelector("#cfe-fields");
    const saveBtn  = root.querySelector("#cfe-save");
    const statusEl = root.querySelector("#cfe-status");
    const titleEl  = root.querySelector("#cfe-title");

    const targetPath = elementConfig && elementConfig.target;

    if (!targetPath) {
        statusEl.textContent = "Missing \"target\" in this element's config.json.";
        statusEl.className = "admin-status admin-status--error";
        return;
    }

    // "name" overrides the displayed title; blank/missing falls back to the
    // target path, exactly as before.
    const displayName = elementConfig && typeof elementConfig.name === "string" && elementConfig.name.trim()
        ? elementConfig.name.trim()
        : targetPath;

    if (titleEl) titleEl.textContent = displayName;

    let data = null;

    function render() {
        fieldsEl.innerHTML = "";
        renderObject(data, fieldsEl, "", data);
    }

    fetch(`/api/file?path=${encodeURIComponent(targetPath)}`)
        .then(r => r.json())
        .then((config) => {
            if (config && config.error) throw new Error(config.error);
            data = config;
            render();
        })
        .catch((e) => {
            statusEl.textContent = `Failed to load ${targetPath}: ${e.message}`;
            statusEl.className = "admin-status admin-status--error";
        });

    saveBtn.addEventListener("click", () => {
        statusEl.textContent = "Saving…";
        statusEl.className = "admin-status";
        fetch(`/api/file?path=${encodeURIComponent(targetPath)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        })
            .then(r => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                statusEl.textContent = "Saved.";
                statusEl.className = "admin-status admin-status--ok";
            })
            .catch((e) => {
                statusEl.textContent = `Save failed: ${e.message}`;
                statusEl.className = "admin-status admin-status--error";
            });
    });
}
