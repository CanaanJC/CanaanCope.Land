// ─────────────────────────────────────────────────────────────────────────────
// Shared generic JSON-editor engine.
//
// admin.js always imports this module for every element and calls
// initJsonEditor(root, elementConfig). By default it behaves exactly like the
// old master.json/element.js (recursive object editor, Save button, status
// line) PLUS: every string leaf field automatically shows a small square
// image preview + compact single-line input instead of a full textarea
// whenever its value resolves as a loadable image — either an absolute URL,
// or a path relative to the public site (tried against both the configured
// siteAddress AND the local LAN address, mirroring the "Public Page" /
// "Local Page" fallback already used in admin.js's header).
//
// Per-element element.js files (loaded AFTER this, if present) receive the
// returned `core` handle and can opt into array/card mode and attach field
// hooks (e.g. upload buttons) — see the bottom of this file for the full
// core API.
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
        setValue(v) { input.value = v ?? ""; refreshPreview(); },
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
        setValue(v) { text.value = v ?? ""; wireColorPairing(); autoGrow(text); },
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

function renderObject(obj, container, pathPrefix, data, fieldHooks) {
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
            renderObject(value, fieldset, fullPath, data, fieldHooks);
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
            row.appendChild(buildJsonLinesField(value, setAtPath));
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

    // Elements that don't use this core's HTML shape (e.g. archive,
    // logo-uploader) simply have no #ej-container — bail out quietly so
    // their own bespoke element.js can take over completely.
    if (!containerEl) {
        return {
            getData: () => null,
            setData: () => {},
            save: () => {},
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

    function setStatus(text, kind) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    // ── Object mode render ──
    function renderObjectMode() {
        containerEl.innerHTML = "";
        renderObject(data, containerEl, "", data, fieldHooks);
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
            });
            containerEl.appendChild(card);
        });
    }

    function render() {
        if (mode === "array") renderArrayMode();
        else renderObjectMode();
    }

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
            if (mode !== "array") return;
            const newItem = arrayConfig.newItemFactory ? arrayConfig.newItemFactory() : {};
            data.push(newItem);
            renderArrayMode();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            setStatus("Saving…");
            fetch(endpoint.put, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            })
                .then(r => r.json())
                .then((res) => {
                    if (res.error) throw new Error(res.error);
                    setStatus("Saved.", "ok");
                })
                .catch((e) => {
                    setStatus(`Save failed: ${e.message}`, "error");
                });
        });
    }

    // ── Public core handle ──
    const core = {
        getData: () => data,
        setData: (newData) => { data = newData; render(); },
        save: () => saveBtn && saveBtn.click(),
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
