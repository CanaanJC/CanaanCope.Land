// ─────────────────────────────────────────────────────────────────────────────
// Shared generic JSON-editor engine.
//
// admin.js always imports this module for every element and calls
// initJsonEditor(root, elementConfig). By default it behaves exactly like the
// old master.json/element.js (recursive object editor, Save button, status
// line) PLUS:
//   - every string leaf field automatically shows a small square image
//     preview + compact single-line input instead of a full textarea
//     whenever its value resolves as a loadable image — either an absolute
//     URL, or a path relative to the public site (tried against both the
//     configured siteAddress AND the local LAN address, mirroring the
//     "Public Page" / "Local Page" fallback already used in admin.js's
//     header).
//   - any field whose KEY is literally "font" automatically gets a font
//     upload button (⬆). Clicking it lets you pick a .ttf/.otf/.woff/.woff2
//     file, uploads it to public/fonts/, and renders the resulting path in
//     the actual uploaded font so it's easy to see what font is set. This
//     does NOT work with plain URLs — uploads only. See attachFontUpload().
//   - the "Saved." status message is automatically cleared the moment any
//     further edit is made (typing, checkbox/number/color change, add,
//     delete, or an upload hook setting a field's value) — see notifyEdit()
//     below — so it can never keep claiming something is saved when it's
//     since been changed again.
//   - a "Raw JSON" toggle button, injected automatically next to the Save
//     button, lets you switch the whole editor to a plain textarea showing
//     the raw JSON — useful for hand-adding a field the visual editor
//     doesn't otherwise expose a control for. Switching back parses your
//     edits back into the visual editor (invalid JSON keeps you in raw mode
//     with an alert). Saving while in raw mode parses it first automatically.
//   - when elementConfig.isBlogEditor is true (set only by the Blog Editor's
//     own config.json mode — see ADMIN/blog-editor/blog-editor.js), any
//     array field whose KEY is literally "date" is rendered as a special
//     date-chip list instead of the generic JSON-lines textarea: each date
//     shows as a chip with an "×" to remove it, and a "+" button opens a
//     small native calendar picker to add a new date. This ONLY applies
//     inside the Blog Editor's config.json editor — every other element on
//     the main Admin page (including any other array field anywhere else)
//     renders exactly as before.
//
// Per-element element.js files (loaded AFTER this, if present) receive the
// returned `core` handle and can opt into array/card mode and attach field
// hooks (e.g. upload buttons) — see the bottom of this file for the full
// core API. `core.save()` returns a Promise<{ ok, error }> so callers can
// react to success/failure themselves instead of relying solely on the
// internal #ej-status line.
// ─────────────────────────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

// ── Auto-grow textarea helper ────────────────────────────────────────────────

function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

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

// ── Base-URL candidates for resolving relative paths ─────────────────────────
// Mirrors admin.js's own "Public Page" (siteAddress) / "Local Page"
// (this admin page's hostname + hosting.port) header logos — same two
// candidates, tried in the same order, cached once per page load.

let _baseCandidatesPromise = null;
function getBaseCandidates() {
    if (!_baseCandidatesPromise) {
        _baseCandidatesPromise = fetch("/api/config")
            .then(r => r.json())
            .then((config) => {
                const bases = [];
                const siteAddress = config && config.siteAddress;
                if (siteAddress) bases.push(siteAddress.replace(/\/$/, ""));
                const port = config && config.hosting && config.hosting.port;
                if (port) bases.push(`http://${window.location.hostname}:${port}`);
                return bases;
            })
            .catch(() => []);
    }
    return _baseCandidatesPromise;
}

// ── Image-link resolution, cached per exact string value ────────────────────
// Resolves a field's raw value to an actually-loadable image URL, or null.
// Absolute http(s) URLs are tested as-is. Anything else is treated as a path
// relative to the public site root and tried against every base candidate,
// in order, until one succeeds.

function tryLoadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = url;
        setTimeout(() => finish(false), 4000);
    });
}

async function resolveImageUrl(trimmedValue) {
    if (/^https?:\/\//i.test(trimmedValue)) {
        const ok = await tryLoadImage(trimmedValue);
        return ok ? trimmedValue : null;
    }

    const bases = await getBaseCandidates();
    const relPath = trimmedValue.replace(/^\//, "");
    for (const base of bases) {
        const url = `${base}/${relPath}`;
        const ok = await tryLoadImage(url);
        if (ok) return url;
    }
    return null;
}

const _imageResolveCache = new Map(); // trimmed value -> Promise<string|null>

function getResolvedImageUrl(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return Promise.resolve(null);
    if (_imageResolveCache.has(trimmed)) return _imageResolveCache.get(trimmed);
    const promise = resolveImageUrl(trimmed);
    _imageResolveCache.set(trimmed, promise);
    return promise;
}

// ── Font-link resolution + live @font-face preview ───────────────────────────
// Deliberately does NOT support absolute URLs — fonts must be uploaded (see
// attachFontUpload below), never linked. A value only ever previews in its
// own font if it resolves as a real, existing public/fonts/-relative file.

const FONT_EXT_FORMATS = {
    ".otf":   "opentype",
    ".ttf":   "truetype",
    ".woff":  "woff",
    ".woff2": "woff2",
};

function getFontFormat(value) {
    const m = /\.([a-zA-Z0-9]+)$/.exec((value || "").trim());
    if (!m) return null;
    return FONT_EXT_FORMATS[`.${m[1].toLowerCase()}`] || null;
}

async function resolveFontUrl(trimmedValue) {
    // Fonts are upload-only — never resolved as absolute URLs.
    if (/^https?:\/\//i.test(trimmedValue)) return null;

    const bases = await getBaseCandidates();
    const relPath = trimmedValue.replace(/^\//, "");
    for (const base of bases) {
        const url = `${base}/${relPath}`;
        try {
            const res = await fetch(url, { method: "HEAD" });
            if (res.ok) return url;
        } catch {
            // try next base
        }
    }
    return null;
}

const _fontResolveCache = new Map(); // trimmed value -> Promise<string|null>

function getResolvedFontUrl(value) {
    const trimmed = (value || "").trim();
    if (!trimmed) return Promise.resolve(null);
    if (_fontResolveCache.has(trimmed)) return _fontResolveCache.get(trimmed);
    const promise = resolveFontUrl(trimmed);
    _fontResolveCache.set(trimmed, promise);
    return promise;
}

let _fontFaceCounter = 0;
const _injectedFontFaces = new Map(); // resolved url -> generated family name

// Applies (or clears) a live @font-face preview on `textEl` (the textarea/
// input actually displaying the font path) based on `value`. Injects one
// <style> @font-face rule per distinct resolved URL, reused across fields.
function applyFontPreview(textEl, value) {
    const format = getFontFormat(value);
    if (!format) {
        textEl.style.fontFamily = "";
        return;
    }

    getResolvedFontUrl(value).then((url) => {
        if (!url) {
            textEl.style.fontFamily = "";
            return;
        }

        let family = _injectedFontFaces.get(url);
        if (!family) {
            family = `admin-custom-font-${_fontFaceCounter++}`;
            const styleTag = document.createElement("style");
            styleTag.textContent = `@font-face { font-family: "${family}"; src: url("${url}") format("${format}"); }`;
            document.head.appendChild(styleTag);
            _injectedFontFaces.set(url, family);
        }

        textEl.style.fontFamily = `"${family}", monospace`;
    });
}

// Attaches the font-upload button + live preview wiring to a field row.
// `field` is { el, getValue, setValue } — the same shape buildStringField
// returns. Built directly into the core (not a per-element hook) so ANY
// object-mode field whose key is literally "font" gets this automatically,
// anywhere in the JSON structure (top-level or nested in a fieldset).
function attachFontUpload(row, field) {
    const getTextEl = () => row.querySelector(".admin-field-input-text");

    function refreshPreview() {
        const el = getTextEl();
        if (el) applyFontPreview(el, field.getValue());
    }

    // Initial preview pass (value may already point at a valid font on load).
    requestAnimationFrame(refreshPreview);
    // Textarea "input" events bubble — re-check on every keystroke too, in
    // case someone hand-types/pastes a path instead of using the uploader.
    row.addEventListener("input", refreshPreview);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".ttf,.otf,.woff,.woff2";
    fileInput.hidden = true;

    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "admin-font-upload-btn";
    uploadBtn.title = "Upload font file (.ttf, .otf, .woff, .woff2)";
    uploadBtn.textContent = "⬆";

    uploadBtn.addEventListener("click", () => fileInput.click());

    function doUpload(file, oldFilename, deleteOld) {
        file.arrayBuffer()
            .then((buf) => {
                const params = new URLSearchParams({ filename: file.name, deleteOld: deleteOld ? "true" : "false" });
                if (oldFilename) params.set("oldFilename", oldFilename);
                return fetch(`/api/upload/font?${params.toString()}`, {
                    method: "POST",
                    headers: { "Content-Type": file.type || "application/octet-stream" },
                    body: buf,
                });
            })
            .then(async (res) => {
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                field.setValue(data.path);
                refreshPreview();
            })
            .catch((e) => alert(`Font upload failed: ${e.message}`));
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;

        const oldValue    = (field.getValue() || "").trim();
        const oldFilename = oldValue ? oldValue.split(/[\\/]+/).pop() : "";
        const newFilename = file.name;

        // No previous font on this field at all — nothing to ask about.
        if (!oldFilename) {
            doUpload(file, "", false);
            return;
        }

        // Same filename as what's already set — confirm an overwrite.
        // Choosing "No" exits the dialog entirely: nothing is uploaded,
        // nothing is deleted, the field is left completely untouched.
        if (oldFilename.toLowerCase() === newFilename.toLowerCase()) {
            if (confirm(`"${oldFilename}" already exists. Overwrite it?`)) {
                doUpload(file, oldFilename, false);
            }
            return;
        }

        // Different filename — ask whether to delete the old font file.
        // "Yes" deletes the old file before writing the new one. "No" keeps
        // both files on disk (public/fonts/) and still switches this field
        // to the newly uploaded font.
        if (confirm(`A different font file already exists ("${oldFilename}"). Delete it?`)) {
            doUpload(file, oldFilename, true);
        } else {
            doUpload(file, oldFilename, false);
        }
    });

    row.appendChild(uploadBtn);
    row.appendChild(fileInput);
}

// ── Compact (image-preview) row builder ─────────────────────────────────────

function buildCompactRow(initialValue, onInput) {
    const holder = document.createElement("div");
    holder.className = "admin-field-value-wrap";

    const img = document.createElement("img");
    img.className = "admin-icon-preview";
    img.alt = "Preview";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "admin-field-input";
    input.value = initialValue ?? "";

    function refreshPreview() {
        const value = (input.value || "").trim();
        if (!value) {
            img.src = FALLBACK_ICON;
            img.classList.add("admin-icon-preview--fallback");
            return;
        }
        getResolvedImageUrl(value).then((url) => {
            if (url) {
                img.classList.remove("admin-icon-preview--fallback");
                img.src = url;
            } else {
                img.src = FALLBACK_ICON;
                img.classList.add("admin-icon-preview--fallback");
            }
        });
    }

    img.addEventListener("error", () => {
        if (img.src !== FALLBACK_ICON) {
            img.src = FALLBACK_ICON;
            img.classList.add("admin-icon-preview--fallback");
        }
    });

    input.addEventListener("input", () => {
        onInput(input.value);
        refreshPreview();
    });

    holder.appendChild(img);
    holder.appendChild(input);
    refreshPreview();

    return {
        el: holder,
        img,
        input,
        setValue(v) {
            input.value = v ?? "";
            refreshPreview();
            // Programmatic value changes (e.g. an upload hook calling
            // api.setValue()) don't naturally fire an "input" event —
            // dispatch one so the shared edit-tracking listener on the
            // container (see initJsonEditor's notifyEdit) still notices
            // and clears any stale "Saved." status.
            input.dispatchEvent(new Event("input", { bubbles: true }));
        },
        refreshPreview,
    };
}

// ── Textarea (default) row builder ──────────────────────────────────────────

function buildTextareaRow(initialValue, onInput) {
    const holder = document.createElement("div");
    holder.className = "admin-field-value-wrap";

    const text = document.createElement("textarea");
    text.className = "admin-field-input-text";
    text.rows = 1;
    text.value = initialValue ?? "";

    let colorInput = null;

    function wireColorPairing() {
        if (!HEX_RE.test(text.value || "")) {
            if (colorInput) { colorInput.remove(); colorInput = null; }
            return;
        }
        if (!colorInput) {
            colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.className = "admin-field-color";
            holder.insertBefore(colorInput, text);
            colorInput.addEventListener("input", () => {
                text.value = colorInput.value;
                onInput(colorInput.value);
                autoGrow(text);
            });
        }
        colorInput.value = text.value.length === 4
            ? `#${[...text.value.slice(1)].map(c => c + c).join("")}`
            : text.value;
    }

    text.addEventListener("input", () => {
        onInput(text.value);
        wireColorPairing();
        autoGrow(text);
    });

    holder.appendChild(text);
    wireColorPairing();
    attachAutoGrow(text);

    return {
        el: holder,
        text,
        setValue(v) {
            text.value = v ?? "";
            wireColorPairing();
            autoGrow(text);
            // See buildCompactRow.setValue's comment — programmatic
            // updates need a manually-dispatched "input" event so the
            // shared edit-tracking listener notices.
            text.dispatchEvent(new Event("input", { bubbles: true }));
        },
    };
}

// ── String field: toggles between textarea and compact image-preview mode ──

function buildStringField(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "admin-field-value-wrap";
    wrap.style.flex = "1 1 160px";

    let currentValue = value ?? "";
    let usingCompact = false;
    let debounceTimer = null;
    let evalToken = 0; // guards against stale async results after rapid edits

    const isHexLike = () => HEX_RE.test((currentValue || "").trim());

    const textarea = buildTextareaRow(currentValue, handleInput);
    const compact  = buildCompactRow(currentValue, handleInput);

    wrap.appendChild(textarea.el);

    function swapTo(mode) {
        if (mode === "compact" && !usingCompact) {
            wrap.innerHTML = "";
            compact.setValue(currentValue);
            wrap.appendChild(compact.el);
            usingCompact = true;
        } else if (mode === "textarea" && usingCompact) {
            wrap.innerHTML = "";
            textarea.setValue(currentValue);
            wrap.appendChild(textarea.el);
            usingCompact = false;
        }
    }

    function evaluate() {
        if (isHexLike()) { swapTo("textarea"); return; }
        const token = ++evalToken;
        getResolvedImageUrl(currentValue).then((url) => {
            if (token !== evalToken) return; // value changed again meanwhile
            swapTo(url ? "compact" : "textarea");
        });
    }

    function handleInput(v) {
        currentValue = v;
        onChange(v);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(evaluate, 400);
    }

    evaluate(); // initial check on render

    return {
        el: wrap,
        getValue: () => currentValue,
        setValue: (v) => {
            currentValue = v;
            onChange(v);
            if (usingCompact) compact.setValue(v); else textarea.setValue(v);
            evaluate();
        },
    };
}

// ── Array-of-JSON-lines editor (used for raw arrays inside object mode —
// NOT the card/array mode used by library-editor / sidebar.json) ──

function buildJsonLinesField(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "admin-field-value-wrap";

    const text = document.createElement("textarea");
    text.className = "admin-field-input-text";
    text.rows = 1;
    text.value = value.map(item => JSON.stringify(item)).join("\n");

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
        autoGrow(text);
    });

    attachAutoGrow(text);
    wrap.appendChild(text);
    return wrap;
}

// ── Date-list editor (Blog Editor's config.json "date" field ONLY) ──────────
//
// Renders `value` (an array of date strings, e.g. ["2026-08-29"]) as a row
// of chips, each with an "×" to remove it, plus a "+" button that reveals a
// small native <input type="date"> calendar picker for adding a new date.
// Only ever mounted when elementConfig.isBlogEditor is true AND the field
// key is literally "date" — see renderObject() below.

function buildDateListField(value, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "admin-datelist";

    let dates = Array.isArray(value) ? value.slice() : [];

    const chipsRow = document.createElement("div");
    chipsRow.className = "admin-datelist-row";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "admin-datelist-add";
    addBtn.title = "Add a date";
    addBtn.textContent = "+";

    const calendarInput = document.createElement("input");
    calendarInput.type = "date";
    calendarInput.className = "admin-datelist-calendar";
    calendarInput.hidden = true;

    function emit() {
        onChange(dates.slice());
    }

    function renderChips() {
        chipsRow.innerHTML = "";
        dates.forEach((dateStr, index) => {
            const chip = document.createElement("span");
            chip.className = "admin-datelist-chip";

            const label = document.createElement("span");
            label.className = "admin-datelist-chip-label";
            label.textContent = dateStr;
            chip.appendChild(label);

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "admin-datelist-chip-remove";
            removeBtn.title = "Remove this date";
            removeBtn.textContent = "×";
            removeBtn.addEventListener("click", () => {
                dates.splice(index, 1);
                emit();
                renderChips();
                // Manually fire "input" so the shared edit-tracking
                // listener (notifyEdit) clears any stale "Saved." status.
                wrap.dispatchEvent(new Event("input", { bubbles: true }));
            });
            chip.appendChild(removeBtn);

            chipsRow.appendChild(chip);
        });
        chipsRow.appendChild(addBtn);
    }

    addBtn.addEventListener("click", () => {
        calendarInput.hidden = !calendarInput.hidden;
        if (!calendarInput.hidden) {
            calendarInput.value = "";
            calendarInput.focus();
            if (typeof calendarInput.showPicker === "function") {
                try { calendarInput.showPicker(); } catch {}
            }
        }
    });

    calendarInput.addEventListener("change", () => {
        const picked = calendarInput.value;
        if (picked) {
            dates.push(picked);
            emit();
            renderChips();
            wrap.dispatchEvent(new Event("input", { bubbles: true }));
        }
        calendarInput.value = "";
        calendarInput.hidden = true;
    });

    renderChips();
    wrap.appendChild(chipsRow);
    wrap.appendChild(calendarInput);

    return wrap;
}

// ── Shared confirm modal (delete / overwrite) — one per element instance ──

function createConfirmModal(root) {
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";
    overlay.hidden = true;

    const box = document.createElement("div");
    box.className = "admin-modal-box";

    const message = document.createElement("p");
    message.className = "admin-modal-message";

    const actions = document.createElement("div");
    actions.className = "admin-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "admin-button";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "admin-button admin-button--danger";
    confirmBtn.type = "button";

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    box.appendChild(message);
    box.appendChild(actions);
    overlay.appendChild(box);
    root.appendChild(overlay);

    let onConfirm = null;

    function close() {
        overlay.hidden = true;
        onConfirm = null;
    }

    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    confirmBtn.addEventListener("click", () => { if (onConfirm) onConfirm(); close(); });

    return {
        open(messageText, confirmLabel, callback) {
            message.textContent = messageText;
            confirmBtn.textContent = confirmLabel || "Delete";
            onConfirm = callback;
            overlay.hidden = false;
        },
    };
}

// ── Endpoint resolution ──────────────────────────────────────────────────────
// Every element — object mode or array mode — reads/writes via the same
// generic file endpoint, keyed off config.json's "target" path. No special
// cases needed; /api/file already validates and scopes paths to .json files
// inside the project root.

function resolveEndpoint(elementConfig) {
    const target = elementConfig && elementConfig.target;
    const url = `/api/file?path=${encodeURIComponent(target || "")}`;
    return { get: url, put: url };
}

// ── Object-mode renderer ─────────────────────────────────────────────────────

function renderObject(obj, container, pathPrefix, data, fieldHooks, isBlogEditor) {
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
            renderObject(value, fieldset, fullPath, data, fieldHooks, isBlogEditor);
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
            // Blog Editor-only special case: the "date" array field gets
            // the chip/calendar widget instead of the generic JSON-lines
            // textarea. Everywhere else (main Admin page, any other
            // element), arrays render exactly as before.
            if (isBlogEditor && key === "date") {
                row.appendChild(buildDateListField(value, setAtPath));
            } else {
                row.appendChild(buildJsonLinesField(value, setAtPath));
            }
            container.appendChild(row);
            continue;
        }

        if (typeof value === "boolean") {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = value;
            input.className = "admin-field-input";
            input.style.flex = "0 0 auto";
            input.addEventListener("change", () => setAtPath(input.checked));
            row.appendChild(input);
            container.appendChild(row);
            continue;
        }

        if (typeof value === "number") {
            const input = document.createElement("input");
            input.type = "number";
            input.className = "admin-field-input";
            input.value = value;
            input.addEventListener("input", () => setAtPath(input.valueAsNumber));
            row.appendChild(input);
            container.appendChild(row);
            continue;
        }

        // String — the auto image-preview-aware field.
        const field = buildStringField(value, setAtPath);
        row.appendChild(field.el);
        container.appendChild(row);

        // Built-in: any field literally named "font" gets a font-upload
        // button + live font-family preview, regardless of nesting depth.
        if (key === "font") {
            attachFontUpload(row, field);
        }

        const hooks = fieldHooks.get(key);
        if (hooks) {
            for (const hook of hooks) {
                hook(row, { getValue: field.getValue, setValue: field.setValue }, null);
            }
        }
    }
}

// ── Public entry point ───────────────────────────────────────────────────────

export default function initJsonEditor(root, elementConfig) {
    const titleEl     = root.querySelector("#ej-title");
    const containerEl = root.querySelector("#ej-container");
    const addBtn      = root.querySelector("#ej-add");
    const saveBtn     = root.querySelector("#ej-save");
    const statusEl    = root.querySelector("#ej-status");

    // True only when mounted from the Blog Editor's own config.json mode
    // (see blog-editor.js's mountConfigEditor). Gates the "date" field's
    // special chip/calendar widget so it never affects any other element.
    const isBlogEditor = !!(elementConfig && elementConfig.isBlogEditor);

    // Elements that don't use this core's HTML shape (e.g. archive,
    // logo-uploader, admin-master.json's Panel Layout editor) simply have
    // no #ej-container — bail out quietly so their own bespoke element.js
    // can take over completely.
    if (!containerEl) {
        return {
            getData: () => null,
            setData: () => {},
            save: () => Promise.resolve({ ok: false, error: "No editor mounted" }),
            reload: () => {},
            setArrayMode: () => {},
            setCardTitle: () => {},
            setNewItemFactory: () => {},
            registerFieldHook: () => {},
            confirm: () => {},
            setStatus: () => {},
        };
    }

    const endpoint = resolveEndpoint(elementConfig);
    const fieldHooks = new Map(); // key -> array of hook fns

    const displayName = elementConfig && typeof elementConfig.name === "string" && elementConfig.name.trim()
        ? elementConfig.name.trim()
        : (elementConfig && elementConfig.target) || "";

    if (titleEl && displayName) titleEl.textContent = displayName;

    const confirmModal = createConfirmModal(root);

    let data = null;
    let mode = "object"; // or "array"
    let arrayConfig = null; // { fields, newItemFactory, addLabel, cardTitle }
    let rawMode = false;

    function setStatus(text, kind) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    // Clears the status line the moment ANY edit happens, but only if it's
    // currently showing the "Saved." (ok) message — so it never keeps
    // claiming the data is saved once it's been changed again since. Left
    // alone if the status is empty, an in-progress "Saving…", or an error.
    function notifyEdit() {
        if (statusEl && statusEl.classList.contains("admin-status--ok")) {
            setStatus("");
        }
    }

    // Delegated listener on the container catches virtually every edit
    // automatically: typing in a textarea/text input, checkbox toggles,
    // number inputs, the color-picker's paired <input type="color">, the
    // JSON-lines array textarea, and the date-list widget's own manually-
    // dispatched "input" events. "input" events bubble by default and
    // nothing in this file calls stopPropagation, so this single pair of
    // listeners is enough — no need to instrument every field individually.
    containerEl.addEventListener("input", notifyEdit);
    containerEl.addEventListener("change", notifyEdit);

    // ── Object mode render ──
    function renderObjectMode() {
        containerEl.innerHTML = "";
        renderObject(data, containerEl, "", data, fieldHooks, isBlogEditor);
    }

    // ── Array/card mode render ──
    function buildFieldRow(item, fieldDef) {
        const row = document.createElement("div");
        row.className = "admin-field-row";
        const label = document.createElement("label");
        label.className = "admin-field-label";
        label.textContent = fieldDef.label;
        row.appendChild(label);

        if (fieldDef.type === "checkbox") {
            const input = document.createElement("input");
            input.type = "checkbox";
            input.className = "admin-field-input";
            input.checked = !!item[fieldDef.key];
            input.addEventListener("change", () => { item[fieldDef.key] = input.checked; });
            row.appendChild(input);
            return row;
        }

        if (fieldDef.type === "number") {
            const input = document.createElement("input");
            input.type = "number";
            input.className = "admin-field-input";
            input.value = item[fieldDef.key] ?? "";
            input.addEventListener("input", () => { item[fieldDef.key] = input.valueAsNumber; });
            row.appendChild(input);
            return row;
        }

        // text (string, image-preview aware)
        const field = buildStringField(item[fieldDef.key] ?? "", (v) => { item[fieldDef.key] = v; });
        row.appendChild(field.el);

        // Built-in: array/card-mode fields named "font" also get the
        // font-upload button, same as object mode.
        if (fieldDef.key === "font") {
            attachFontUpload(row, field);
        }

        const hooks = fieldHooks.get(fieldDef.key);
        if (hooks) {
            for (const hook of hooks) {
                hook(row, { getValue: field.getValue, setValue: field.setValue }, item);
            }
        }

        return row;
    }

    function buildCard(item, onDelete) {
        const card = document.createElement("div");
        card.className = "admin-lib-card";

        const summary = document.createElement("div");
        summary.className = "admin-lib-summary";

        let titleNode = arrayConfig.cardTitle
            ? arrayConfig.cardTitle(item)
            : document.createTextNode("");
        if (typeof titleNode === "string") {
            const span = document.createElement("span");
            span.className = "admin-lib-title";
            span.textContent = titleNode;
            titleNode = span;
        }
        summary.appendChild(titleNode);

        const actions = document.createElement("div");
        actions.className = "admin-lib-actions";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "admin-button admin-button--danger";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
            confirmModal.open(`Are you sure you want to delete this item?`, "Delete", onDelete);
        });

        actions.appendChild(deleteBtn);
        summary.appendChild(actions);
        card.appendChild(summary);

        const fieldsWrap = document.createElement("div");
        fieldsWrap.className = "admin-lib-fields";

        for (const fieldDef of arrayConfig.fields) {
            fieldsWrap.appendChild(buildFieldRow(item, fieldDef));
        }

        card.appendChild(fieldsWrap);
        return card;
    }

    function renderArrayMode() {
        containerEl.innerHTML = "";
        data.forEach((item, index) => {
            const card = buildCard(item, () => {
                data.splice(index, 1);
                renderArrayMode();
                notifyEdit(); // deleting a card is an edit — clear any "Saved." message
            });
            containerEl.appendChild(card);
        });
    }

    function render() {
        if (mode === "array") renderArrayMode();
        else renderObjectMode();
    }

    // ── Raw JSON toggle ──────────────────────────────────────────────────────
    // Injected automatically for every element using this core — lets you
    // hand-edit the underlying JSON as plain text (e.g. to add a field the
    // visual editor doesn't have a control for yet). Toggling back to the
    // visual editor parses your edits back into `data`; invalid JSON keeps
    // you in raw mode with an alert rather than silently discarding it.

    const rawToggleBtn = document.createElement("button");
    rawToggleBtn.type = "button";
    rawToggleBtn.className = "admin-button admin-raw-toggle-btn";
    rawToggleBtn.textContent = "Raw JSON";

    const rawTextarea = document.createElement("textarea");
    rawTextarea.className = "admin-field-input-text admin-raw-textarea";
    rawTextarea.spellcheck = false;
    rawTextarea.hidden = true;

    if (saveBtn && saveBtn.parentNode) {
        saveBtn.parentNode.insertBefore(rawToggleBtn, saveBtn);
    } else {
        root.insertBefore(rawToggleBtn, containerEl);
    }
    containerEl.insertAdjacentElement("afterend", rawTextarea);

    rawTextarea.addEventListener("input", notifyEdit);

    function enterRawMode() {
        rawTextarea.value = JSON.stringify(data, null, 4);
        containerEl.hidden = true;
        rawTextarea.hidden = false;
        if (addBtn) addBtn.dataset.rawHidden = addBtn.hidden ? "" : (addBtn.hidden = true, "1");
        rawMode = true;
        rawToggleBtn.textContent = "Visual Editor";
        requestAnimationFrame(() => autoGrow(rawTextarea));
    }

    // Returns true if it successfully left raw mode (or wasn't in it).
    function exitRawMode(applyChanges) {
        if (applyChanges) {
            try {
                data = JSON.parse(rawTextarea.value);
            } catch (e) {
                alert(`Invalid JSON — fix it or it can't be applied:\n\n${e.message}`);
                return false;
            }
        }
        containerEl.hidden = false;
        rawTextarea.hidden = true;
        if (addBtn && addBtn.dataset.rawHidden === "1") {
            addBtn.hidden = false;
            delete addBtn.dataset.rawHidden;
        }
        rawMode = false;
        rawToggleBtn.textContent = "Raw JSON";
        render();
        return true;
    }

    rawToggleBtn.addEventListener("click", () => {
        if (rawMode) exitRawMode(true);
        else enterRawMode();
    });

    attachAutoGrow(rawTextarea);

    // ── Load ──
    fetch(endpoint.get)
        .then(r => r.json())
        .then((result) => {
            if (result && result.error) throw new Error(result.error);
            data = result;
            render();
        })
        .catch((e) => {
            setStatus(`Failed to load: ${e.message}`, "error");
        });

    if (addBtn) {
        addBtn.addEventListener("click", () => {
            if (mode !== "array" || rawMode) return;
            const newItem = arrayConfig.newItemFactory ? arrayConfig.newItemFactory() : {};
            data.push(newItem);
            renderArrayMode();
            notifyEdit(); // adding a card is an edit — clear any "Saved." message
        });
    }

    // ── Save (used by both the internal #ej-save click and core.save()) ──────
    // If currently in raw mode, parses the raw textarea into `data` first
    // (without necessarily leaving raw mode) so raw edits are never lost.
    // Returns a Promise<{ ok, error }> so callers (e.g. the Blog Editor's
    // own Save button) can react without depending on the status text.
    function performSave() {
        if (rawMode) {
            try {
                data = JSON.parse(rawTextarea.value);
            } catch (e) {
                setStatus(`Invalid JSON: ${e.message}`, "error");
                return Promise.resolve({ ok: false, error: e.message });
            }
        }

        setStatus("Saving…");
        return fetch(endpoint.put, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        })
            .then(r => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                setStatus("Saved.", "ok");
                return { ok: true };
            })
            .catch((e) => {
                setStatus(`Save failed: ${e.message}`, "error");
                return { ok: false, error: e.message };
            });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", () => { performSave(); });
    }

    // ── Public core handle ──
    const core = {
        getData: () => data,
        setData: (newData) => { data = newData; render(); },
        save: () => performSave(),
        reload: () => {
            fetch(endpoint.get).then(r => r.json()).then((result) => { data = result; render(); });
        },
        setArrayMode(config) {
            mode = "array";
            arrayConfig = {
                fields: config.fields || [],
                newItemFactory: config.newItemFactory || (() => ({})),
                cardTitle: config.cardTitle || null,
                addLabel: config.addLabel || "+ Add",
            };
            if (addBtn) {
                addBtn.hidden = false;
                addBtn.textContent = arrayConfig.addLabel;
            }
            if (data) render();
        },
        setCardTitle(fn) {
            if (arrayConfig) arrayConfig.cardTitle = fn;
        },
        setNewItemFactory(fn) {
            if (arrayConfig) arrayConfig.newItemFactory = fn;
        },
        registerFieldHook(key, fn) {
            if (!fieldHooks.has(key)) fieldHooks.set(key, []);
            fieldHooks.get(key).push(fn);
            if (data) render();
        },
        confirm(message, confirmLabel, callback) {
            confirmModal.open(message, confirmLabel, callback);
        },
        setStatus,
    };

    return core;
}
