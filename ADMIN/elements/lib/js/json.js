import { attachFontUpload, GOOGLE_FONT_PREFIX } from "./font-picker.js";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ICON_UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.avif,.gif,.ico,.bmp";
const FALLBACK_ICON = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" fill="#3a3a3a" stroke="#5a5a5a"/><path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/></svg>'
);

let baseCandidatesPromise = null;
const imageResolveCache = new Map();

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className = "admin-button") {
    const node = el("button", className, text);
    node.type = "button";
    return node;
}

function fireInput(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
}

function autoGrow(textarea) {
    if (!textarea.isConnected || textarea.hidden) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function attachAutoGrow(textarea) {
    let lastWidth = null;
    requestAnimationFrame(() => autoGrow(textarea));
    const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
            if (entry.contentRect.width === lastWidth) continue;
            lastWidth = entry.contentRect.width;
            autoGrow(textarea);
        }
    });
    observer.observe(textarea);
}

async function fetchJson(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.error) {
            const message = typeof data?.error === "string"
                ? data.error
                : data?.error?.message;
            throw new Error(message || `HTTP ${response.status}`);
        }
        if (data === null) throw new Error("The server returned an invalid JSON response.");
        return data;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abort);
    }
}

function getBaseCandidates() {
    if (!baseCandidatesPromise) {
        baseCandidatesPromise = fetchJson("/api/config")
            .then(config => {
                const bases = [window.location.origin];
                if (config.siteAddress) bases.push(config.siteAddress.replace(/\/$/, ""));
                if (config.hosting?.port) {
                    bases.push(`http://${window.location.hostname}:${config.hosting.port}`);
                }
                return [...new Set(bases)];
            })
            .catch(() => [window.location.origin]);
    }
    return baseCandidatesPromise;
}

function tryLoadImage(url) {
    return new Promise(resolve => {
        const image = new Image();
        let done = false;
        const finish = ok => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), 4000);
        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = url;
    });
}

async function resolveImageUrl(value) {
    if (/^https?:\/\//i.test(value)) {
        return await tryLoadImage(value) ? value : null;
    }
    const bases = await getBaseCandidates();
    const relative = value.replace(/^\//, "");
    for (const base of bases) {
        const url = `${base}/${relative}`;
        if (await tryLoadImage(url)) return url;
    }
    return null;
}

function getResolvedImageUrl(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || trimmed.startsWith(GOOGLE_FONT_PREFIX)) return Promise.resolve(null);
    if (!imageResolveCache.has(trimmed)) {
        imageResolveCache.set(trimmed, resolveImageUrl(trimmed));
    }
    return imageResolveCache.get(trimmed);
}

function attachIconUpload(row, field) {
    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = ICON_UPLOAD_ACCEPT;
    fileInput.hidden = true;

    const uploadButton = button("⬆", "admin-icon-upload-btn");
    uploadButton.title = "Upload icon image";
    uploadButton.setAttribute("aria-label", uploadButton.title);
    uploadButton.addEventListener("click", () => fileInput.click());

    async function doUpload(file, oldFilename, deleteOld) {
        uploadButton.disabled = true;
        try {
            const params = new URLSearchParams({
                filename: file.name,
                deleteOld: deleteOld ? "true" : "false",
            });
            if (oldFilename) params.set("oldFilename", oldFilename);
            const data = await fetchJson(`/api/upload/icon?${params}`, {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: await file.arrayBuffer(),
            });
            imageResolveCache.delete(String(data.path ?? "").trim());
            field.setValue(data.path);
        } catch (error) {
            alert(`Icon upload failed: ${error.message}`);
        } finally {
            uploadButton.disabled = false;
        }
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        const oldValue = String(field.getValue() || "").trim();
        const oldFilename = oldValue ? oldValue.split(/[\\/]+/).pop() : "";

        if (!oldFilename) {
            doUpload(file, "", false);
        } else if (oldFilename.toLowerCase() === file.name.toLowerCase()) {
            if (confirm(`"${oldFilename}" already exists. Overwrite it?`)) {
                doUpload(file, oldFilename, false);
            }
        } else {
            doUpload(file, oldFilename, confirm(`A different icon file already exists ("${oldFilename}"). Delete it?`));
        }
    });

    row.append(uploadButton, fileInput);
}

function buildCompactRow(initialValue, onInput) {
    const holder = el("div", "admin-field-value-wrap");
    const image = el("img", "admin-icon-preview");
    image.alt = "Preview";
    const input = el("input", "admin-field-input");
    input.type = "text";
    input.value = initialValue ?? "";
    let token = 0;

    function fallback() {
        image.src = FALLBACK_ICON;
        image.classList.add("admin-icon-preview--fallback");
    }

    function refreshPreview() {
        const currentToken = ++token;
        const value = input.value.trim();
        if (!value) {
            fallback();
            return;
        }
        getResolvedImageUrl(value).then(url => {
            if (currentToken !== token) return;
            if (!url) {
                fallback();
                return;
            }
            image.classList.remove("admin-icon-preview--fallback");
            image.src = url;
        });
    }

    image.addEventListener("error", () => {
        if (image.src !== FALLBACK_ICON) fallback();
    });
    input.addEventListener("input", () => {
        onInput(input.value);
        refreshPreview();
    });
    holder.append(image, input);

    return {
        el: holder,
        img: image,
        input,
        setValue(value, emit = true) {
            input.value = value ?? "";
            refreshPreview();
            if (emit) fireInput(input);
        },
        refreshPreview,
    };
}

function buildTextareaRow(initialValue, onInput, allowColor = true) {
    const holder = el("div", "admin-field-value-wrap");
    const text = el("textarea", "admin-field-input-text");
    text.rows = 1;
    text.value = initialValue ?? "";
    let colorInput = null;

    function wireColorPairing() {
        if (!allowColor || !HEX_RE.test(text.value)) {
            colorInput?.remove();
            colorInput = null;
            return;
        }
        if (!colorInput) {
            colorInput = el("input", "admin-field-color");
            colorInput.type = "color";
            colorInput.setAttribute("aria-label", "Choose colour");
            holder.insertBefore(colorInput, text);
            colorInput.addEventListener("input", () => {
                text.value = colorInput.value;
                onInput(colorInput.value);
                autoGrow(text);
            });
        }
        colorInput.value = text.value.length === 4
            ? `#${[...text.value.slice(1)].map(character => character + character).join("")}`
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
        setValue(value, emit = true) {
            text.value = value ?? "";
            wireColorPairing();
            autoGrow(text);
            if (emit) fireInput(text);
        },
    };
}

function buildStringField(value, onChange, options = {}) {
    const wrap = el("div", "admin-field-value-wrap");
    let currentValue = value ?? "";
    let usingCompact = false;
    let debounceTimer = null;
    let evalToken = 0;
    const allowImages = options.images !== false;
    const textarea = buildTextareaRow(currentValue, handleInput, options.colors !== false);
    const compact = allowImages ? buildCompactRow(currentValue, handleInput) : null;
    wrap.appendChild(textarea.el);

    function swapTo(mode) {
        const nextCompact = mode === "compact" && !!compact;
        if (nextCompact === usingCompact) return;
        usingCompact = nextCompact;
        const target = usingCompact ? compact : textarea;
        target.setValue(currentValue, false);
        wrap.replaceChildren(target.el);
        if (!usingCompact) requestAnimationFrame(() => autoGrow(textarea.text));
    }

    function evaluate() {
        const token = ++evalToken;
        if (!allowImages || HEX_RE.test(String(currentValue).trim()) || String(currentValue).startsWith(GOOGLE_FONT_PREFIX)) {
            swapTo("textarea");
            return;
        }
        getResolvedImageUrl(currentValue).then(url => {
            if (token === evalToken) swapTo(url ? "compact" : "textarea");
        });
    }

    function handleInput(nextValue) {
        currentValue = nextValue;
        onChange(nextValue);
        clearTimeout(debounceTimer);
        if (allowImages) debounceTimer = setTimeout(evaluate, 400);
    }

    evaluate();

    return {
        el: wrap,
        getValue: () => currentValue,
        setValue(nextValue) {
            currentValue = nextValue ?? "";
            (usingCompact ? compact : textarea).setValue(currentValue);
            evaluate();
        },
    };
}

function buildJsonLinesField(value, onChange) {
    const wrap = el("div", "admin-field-value-wrap");
    const text = el("textarea", "admin-field-input-text");
    text.rows = 1;
    text.value = value.map(item => JSON.stringify(item)).join("\n");

    text.addEventListener("input", () => {
        const lines = text.value.split("\n").map(line => line.trim()).filter(Boolean);
        try {
            onChange(lines.map(line => JSON.parse(line)));
            text.classList.remove("admin-field-input-text--error");
            text.title = "";
        } catch (error) {
            text.classList.add("admin-field-input-text--error");
            text.title = `Invalid JSON on one of the lines: ${error.message}`;
        }
        autoGrow(text);
    });

    attachAutoGrow(text);
    wrap.appendChild(text);
    return wrap;
}

function buildDateListField(value, onChange) {
    const wrap = el("div", "admin-datelist");
    let dates = Array.isArray(value) ? value.slice() : [];
    const chipsRow = el("div", "admin-datelist-row");
    const addButton = button("+", "admin-datelist-add");
    addButton.title = "Add a date";
    const calendar = el("input", "admin-datelist-calendar");
    calendar.type = "date";
    calendar.hidden = true;

    function emit() {
        onChange(dates.slice());
        fireInput(wrap);
    }

    function renderChips() {
        chipsRow.replaceChildren();
        dates.forEach((date, index) => {
            const chip = el("span", "admin-datelist-chip");
            const remove = button("×", "admin-datelist-chip-remove");
            remove.title = "Remove this date";
            remove.addEventListener("click", () => {
                dates.splice(index, 1);
                emit();
                renderChips();
            });
            chip.append(el("span", "admin-datelist-chip-label", date), remove);
            chipsRow.appendChild(chip);
        });
        chipsRow.appendChild(addButton);
    }

    addButton.addEventListener("click", () => {
        calendar.hidden = !calendar.hidden;
        if (!calendar.hidden) {
            calendar.value = "";
            calendar.focus();
            try { calendar.showPicker?.(); } catch {}
        }
    });

    calendar.addEventListener("change", () => {
        if (calendar.value) {
            dates.push(calendar.value);
            emit();
            renderChips();
        }
        calendar.value = "";
        calendar.hidden = true;
    });

    renderChips();
    wrap.append(chipsRow, calendar);
    return wrap;
}

function createConfirmModal(root) {
    const overlay = el("div", "admin-modal-overlay");
    overlay.hidden = true;
    const box = el("div", "admin-modal-box");
    const message = el("p", "admin-modal-message");
    const actions = el("div", "admin-modal-actions");
    const cancelButton = button("Cancel");
    const confirmButton = button("", "admin-button admin-button--danger");
    actions.append(cancelButton, confirmButton);
    box.append(message, actions);
    overlay.appendChild(box);
    root.appendChild(overlay);
    let onConfirm = null;

    function close() {
        overlay.hidden = true;
        onConfirm = null;
    }

    cancelButton.addEventListener("click", close);
    overlay.addEventListener("click", event => {
        if (event.target === overlay) close();
    });
    confirmButton.addEventListener("click", () => {
        const callback = onConfirm;
        close();
        callback?.();
    });

    return {
        open(text, confirmLabel, callback) {
            message.textContent = text;
            confirmButton.textContent = confirmLabel || "Delete";
            onConfirm = callback;
            overlay.hidden = false;
        },
    };
}

function resolveEndpoint(elementConfig) {
    const url = `/api/file?path=${encodeURIComponent(elementConfig?.target || "")}`;
    return { get: url, put: url };
}

function isIconKey(key) {
    return String(key || "").trim().toLowerCase() === "icon";
}

function isFontKey(key) {
    return String(key || "").trim().toLowerCase() === "font";
}

function stringOptions(key, pathSegments = []) {
    const special = isFontKey(key) || pathSegments.some(segment => String(segment).toLowerCase() === "apikeys");
    return special ? { images: false, colors: false } : {};
}

function renderObject(obj, container, pathSegments, data, fieldHooks, isBlogEditor, onFontPick) {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const fullPath = [...pathSegments, key];

        if (value && typeof value === "object" && !Array.isArray(value)) {
            const fieldset = el("fieldset", "admin-fieldset");
            fieldset.appendChild(el("legend", "", key));
            container.appendChild(fieldset);
            renderObject(value, fieldset, fullPath, data, fieldHooks, isBlogEditor, onFontPick);
            continue;
        }

        const row = el("div", "admin-field-row");
        row.appendChild(el("label", "admin-field-label", key));

        function setAtPath(nextValue) {
            let node = data;
            for (let index = 0; index < fullPath.length - 1; index++) node = node[fullPath[index]];
            node[fullPath[fullPath.length - 1]] = nextValue;
        }

        if (Array.isArray(value)) {
            row.appendChild(isBlogEditor && key === "date"
                ? buildDateListField(value, setAtPath)
                : buildJsonLinesField(value, setAtPath));
        } else if (typeof value === "boolean") {
            const input = el("input", "admin-field-input");
            input.type = "checkbox";
            input.checked = value;
            input.style.flex = "0 0 auto";
            input.addEventListener("change", () => setAtPath(input.checked));
            row.appendChild(input);
        } else if (typeof value === "number") {
            const input = el("input", "admin-field-input");
            input.type = "number";
            input.step = "any";
            input.value = value;
            input.addEventListener("input", () => setAtPath(Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null));
            row.appendChild(input);
        } else {
            const field = buildStringField(value, setAtPath, stringOptions(key, fullPath));
            row.appendChild(field.el);
            if (isFontKey(key)) attachFontUpload(row, field, onFontPick);
            if (isIconKey(key)) attachIconUpload(row, field);
            for (const hook of fieldHooks.get(key) || []) {
                hook(row, { getValue: field.getValue, setValue: field.setValue }, null);
            }
        }

        container.appendChild(row);
    }
}

export default function initJsonEditor(root, elementConfig) {
    const titleEl = root.querySelector("#ej-title");
    const containerEl = root.querySelector("#ej-container");
    const addButton = root.querySelector("#ej-add");
    const saveButton = root.querySelector("#ej-save");
    const statusEl = root.querySelector("#ej-status");
    const isBlogEditor = !!elementConfig?.isBlogEditor;
    const onEditHook = typeof elementConfig?.onEdit === "function" ? elementConfig.onEdit : null;
    const onSavedHook = typeof elementConfig?.onSaved === "function" ? elementConfig.onSaved : null;

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
            isDirty: () => false,
        };
    }

    const endpoint = resolveEndpoint(elementConfig);
    const fieldHooks = new Map();
    const displayName = typeof elementConfig?.name === "string" && elementConfig.name.trim()
        ? elementConfig.name.trim()
        : elementConfig?.target || "";
    if (titleEl && displayName) titleEl.textContent = displayName;
    const confirmModal = createConfirmModal(root);

    let data = null;
    let loadFailed = false;
    let mode = "object";
    let arrayConfig = null;
    let rawMode = false;
    let dirty = false;
    let editVersion = 0;
    let savePromise = null;
    let loadToken = 0;

    function setStatus(text, kind) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    function notifyEdit() {
        dirty = true;
        editVersion++;
        if (statusEl?.classList.contains("admin-status--ok")) setStatus("");
        if (onEditHook) {
            try { onEditHook(); } catch (error) { console.error("[json.js] onEdit hook threw:", error); }
        }
    }

    containerEl.addEventListener("input", notifyEdit);
    containerEl.addEventListener("change", notifyEdit);

    async function saveFontSelection() {
        notifyEdit();
        if (savePromise) await savePromise;
        return performSave();
    }

    function renderObjectMode() {
        containerEl.replaceChildren();
        renderObject(data, containerEl, [], data, fieldHooks, isBlogEditor, saveFontSelection);
    }

    function buildFieldRow(item, fieldDef) {
        const row = el("div", "admin-field-row");
        row.appendChild(el("label", "admin-field-label", fieldDef.label || fieldDef.key));

        if (fieldDef.type === "checkbox") {
            const input = el("input", "admin-field-input");
            input.type = "checkbox";
            input.checked = !!item[fieldDef.key];
            input.style.flex = "0 0 auto";
            input.addEventListener("change", () => { item[fieldDef.key] = input.checked; });
            row.appendChild(input);
            return row;
        }

        if (fieldDef.type === "number") {
            const input = el("input", "admin-field-input");
            input.type = "number";
            input.step = "any";
            input.value = item[fieldDef.key] ?? "";
            input.addEventListener("input", () => {
                item[fieldDef.key] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
            });
            row.appendChild(input);
            return row;
        }

        const field = buildStringField(
            item[fieldDef.key] ?? "",
            value => { item[fieldDef.key] = value; },
            stringOptions(fieldDef.key)
        );
        row.appendChild(field.el);
        if (isFontKey(fieldDef.key)) attachFontUpload(row, field, saveFontSelection);
        if (isIconKey(fieldDef.key)) attachIconUpload(row, field);
        for (const hook of fieldHooks.get(fieldDef.key) || []) {
            hook(row, { getValue: field.getValue, setValue: field.setValue }, item);
        }
        return row;
    }

    function buildCard(item, onDelete) {
        const card = el("div", "admin-lib-card");
        const summary = el("div", "admin-lib-summary");
        let title = arrayConfig.cardTitle ? arrayConfig.cardTitle(item) : "";
        if (!(title instanceof Node)) title = el("span", "admin-lib-title", String(title ?? ""));
        summary.appendChild(title);

        const actions = el("div", "admin-lib-actions");
        const remove = button("Delete", "admin-button admin-button--danger");
        remove.addEventListener("click", () => {
            confirmModal.open("Are you sure you want to delete this item?", "Delete", onDelete);
        });
        actions.appendChild(remove);
        summary.appendChild(actions);

        const fields = el("div", "admin-lib-fields");
        for (const fieldDef of arrayConfig.fields) fields.appendChild(buildFieldRow(item, fieldDef));
        card.append(summary, fields);
        return card;
    }

    function renderArrayMode() {
        containerEl.replaceChildren();
        data.forEach((item, index) => {
            containerEl.appendChild(buildCard(item, () => {
                data.splice(index, 1);
                renderArrayMode();
                notifyEdit();
            }));
        });
    }

    function render() {
        if (data === null || data === undefined) {
            containerEl.replaceChildren();
            return;
        }
        if (mode === "array" && Array.isArray(data)) renderArrayMode();
        else renderObjectMode();
    }

    const rawToggle = button("Raw JSON", "admin-button admin-raw-toggle-btn");
    const rawTextarea = el("textarea", "admin-field-input-text admin-raw-textarea");
    rawTextarea.spellcheck = false;
    rawTextarea.hidden = true;

    if (saveButton?.parentNode) saveButton.parentNode.insertBefore(rawToggle, saveButton);
    else root.insertBefore(rawToggle, containerEl);
    containerEl.insertAdjacentElement("afterend", rawTextarea);
    rawTextarea.addEventListener("input", notifyEdit);

    function validRoot(value) {
        return value !== null && typeof value === "object";
    }

    function enterRawMode() {
        if (!validRoot(data)) return;
        rawTextarea.value = JSON.stringify(data, null, 4);
        containerEl.hidden = true;
        rawTextarea.hidden = false;
        if (addButton) {
            addButton.dataset.rawHidden = addButton.hidden ? "" : "1";
            addButton.hidden = true;
        }
        rawMode = true;
        rawToggle.textContent = "Visual Editor";
        requestAnimationFrame(() => autoGrow(rawTextarea));
    }

    function exitRawMode(applyChanges) {
        if (applyChanges) {
            try {
                const parsed = JSON.parse(rawTextarea.value);
                if (!validRoot(parsed)) throw new Error("The root must be a JSON object or array.");
                if (mode === "array" && !Array.isArray(parsed)) throw new Error("This editor requires a JSON array.");
                data = parsed;
            } catch (error) {
                alert(`Invalid JSON — fix it before switching editors:\n\n${error.message}`);
                return false;
            }
        }
        containerEl.hidden = false;
        rawTextarea.hidden = true;
        if (addButton?.dataset.rawHidden === "1") {
            addButton.hidden = false;
            delete addButton.dataset.rawHidden;
        }
        rawMode = false;
        rawToggle.textContent = "Raw JSON";
        render();
        return true;
    }

    rawToggle.addEventListener("click", () => {
        if (rawMode) exitRawMode(true);
        else enterRawMode();
    });
    attachAutoGrow(rawTextarea);

    async function loadData(reload = false) {
        const token = ++loadToken;
        const startingVersion = editVersion;
        try {
            const result = await fetchJson(endpoint.get, { cache: "no-store" });
            if (token !== loadToken) return;
            if (!validRoot(result)) throw new Error("The file must contain a JSON object or array.");
            if (editVersion !== startingVersion) {
                setStatus("Load finished, but newer local edits were kept.", "error");
                return;
            }
            data = result;
            loadFailed = false;
            dirty = false;
            if (rawMode) rawTextarea.value = JSON.stringify(data, null, 4);
            render();
            if (reload) setStatus("Reloaded.");
        } catch (error) {
            if (token !== loadToken) return;
            if (!reload && data === null) loadFailed = true;
            setStatus(`Failed to ${reload ? "reload" : "load"}: ${error.message}`, "error");
        }
    }

    loadData();

    addButton?.addEventListener("click", () => {
        if (mode !== "array" || rawMode || !Array.isArray(data)) return;
        data.push(arrayConfig.newItemFactory ? arrayConfig.newItemFactory() : {});
        renderArrayMode();
        notifyEdit();
    });

    function setSaveBusy(busy) {
        if (!saveButton) return;
        saveButton.disabled = busy;
        if (busy) saveButton.setAttribute("aria-busy", "true");
        else saveButton.removeAttribute("aria-busy");
    }

    async function sendSave(body) {
        const response = await fetch(endpoint.put, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const text = await response.text();
        let parsed = null;
        try { parsed = text.trim() ? JSON.parse(text) : {}; } catch {}
        if (!response.ok || parsed?.error) {
            const message = typeof parsed?.error === "string" ? parsed.error : parsed?.error?.message;
            throw new Error(message || `HTTP ${response.status}`);
        }
        if (!parsed) throw new Error("The server returned an invalid save response.");
        return parsed;
    }

    function performSave() {
        if (savePromise) return savePromise;

        if (rawMode) {
            try {
                const parsed = JSON.parse(rawTextarea.value);
                if (!validRoot(parsed)) throw new Error("The root must be a JSON object or array.");
                if (mode === "array" && !Array.isArray(parsed)) throw new Error("This editor requires a JSON array.");
                data = parsed;
            } catch (error) {
                setStatus(`Invalid JSON: ${error.message}`, "error");
                return Promise.resolve({ ok: false, error: error.message });
            }
        } else if (containerEl.querySelector(".admin-field-input-text--error")) {
            const error = "Fix the invalid JSON field before saving.";
            setStatus(error, "error");
            return Promise.resolve({ ok: false, error });
        }

        if (!validRoot(data)) {
            const error = loadFailed
                ? "This file never loaded — reload the page before saving."
                : "Nothing loaded yet — wait for the editor to finish loading.";
            setStatus(error, "error");
            return Promise.resolve({ ok: false, error });
        }

        let body;
        try {
            body = JSON.stringify(data);
        } catch (error) {
            setStatus(`Could not serialize data: ${error.message}`, "error");
            return Promise.resolve({ ok: false, error: error.message });
        }

        const savedVersion = editVersion;
        setStatus("Saving…");
        setSaveBusy(true);

        savePromise = sendSave(body)
            .catch(firstError => new Promise((resolve, reject) => {
                setTimeout(() => sendSave(body).then(resolve, () => reject(firstError)), 600);
            }))
            .then(() => {
                dirty = editVersion !== savedVersion;
                setStatus(dirty ? "Saved. Newer edits are still unsaved." : "Saved.", dirty ? "" : "ok");
                if (onSavedHook) {
                    try { onSavedHook(); } catch (error) { console.error("[json.js] onSaved hook threw:", error); }
                }
                return { ok: true };
            })
            .catch(error => {
                setStatus(`Save failed: ${error.message}`, "error");
                return { ok: false, error: error.message };
            })
            .finally(() => {
                savePromise = null;
                setSaveBusy(false);
            });

        return savePromise;
    }

    saveButton?.addEventListener("click", () => { performSave(); });

    return {
        getData: () => data,
        setData(newData) {
            loadToken++;
            editVersion++;
            data = newData;
            loadFailed = false;
            if (rawMode) rawTextarea.value = JSON.stringify(data, null, 4);
            render();
        },
        save: () => performSave(),
        reload: () => loadData(true),
        setArrayMode(config) {
            mode = "array";
            arrayConfig = {
                fields: config.fields || [],
                newItemFactory: config.newItemFactory || (() => ({})),
                cardTitle: config.cardTitle || null,
                addLabel: config.addLabel || "+ Add",
            };
            if (addButton) {
                addButton.hidden = rawMode;
                addButton.textContent = arrayConfig.addLabel;
                if (rawMode) addButton.dataset.rawHidden = "1";
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
        isDirty: () => dirty,
    };
}