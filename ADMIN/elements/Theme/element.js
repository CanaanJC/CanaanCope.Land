const DEFAULTS_PATH = "config/defaults.json";

const ROOT_KEY_HINTS = {
    "config/master.json": ["", "master", "defaults"],
    "config/theme.json": ["", "theme", "defaults"],
};

const SKIP_KEYS = new Set(["font", "icon"]);

let defaultsPromise = null;

function loadDefaults() {
    if (!defaultsPromise) {
        defaultsPromise = fetch(`/api/file?path=${encodeURIComponent(DEFAULTS_PATH)}`, { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => (data && typeof data === "object" && !data.error ? data : {}))
            .catch(() => ({}));
    }
    return defaultsPromise;
}

function normalizeTarget(elementConfig) {
    const raw = elementConfig && typeof elementConfig.target === "string" ? elementConfig.target : "";
    return raw.replace(/\\/g, "/").replace(/^\/+/, "");
}

function lookupPath(root, segments) {
    let node = root;
    for (const segment of segments) {
        if (node === null || typeof node !== "object" || Array.isArray(node)) return undefined;
        if (!Object.prototype.hasOwnProperty.call(node, segment)) return undefined;
        node = node[segment];
    }
    return node;
}

function resolveDefault(defaults, rootKeys, segments) {
    if (segments.length === 0) return undefined;

    for (const rootKey of rootKeys) {
        const found = lookupPath(defaults, rootKey ? [rootKey, ...segments] : segments);
        if (found !== undefined) return found;
    }

    for (const key of Object.keys(defaults)) {
        const branch = defaults[key];
        if (branch === null || typeof branch !== "object" || Array.isArray(branch)) continue;
        const found = lookupPath(branch, segments);
        if (found !== undefined) return found;
    }

    return undefined;
}

function pathSegmentsFor(row, containerEl) {
    const label = row.querySelector(":scope > .admin-field-label");
    if (!label) return null;

    const key = (label.textContent || "").trim();
    if (!key) return null;

    const prefix = [];
    let node = row.parentElement;
    while (node && node !== containerEl) {
        if (node.tagName === "FIELDSET") {
            const legend = node.querySelector(":scope > legend");
            const legendKey = legend ? (legend.textContent || "").trim() : "";
            if (legendKey) prefix.unshift(legendKey);
        }
        node = node.parentElement;
    }

    return [...prefix, key];
}

function isSkippedRow(row, key) {
    if (SKIP_KEYS.has(key.toLowerCase())) return true;
    if (row.querySelector(".admin-font-upload-btn")) return true;
    if (row.querySelector(".admin-icon-upload-btn")) return true;
    if (row.querySelector(".admin-datelist")) return true;
    return false;
}

function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
}

function applyValue(row, value) {
    const checkbox = row.querySelector("input.admin-field-input[type='checkbox']");
    if (checkbox) {
        checkbox.checked = !!value;
        fire(checkbox, "change");
        fire(checkbox, "input");
        return true;
    }

    const number = row.querySelector("input.admin-field-input[type='number']");
    if (number) {
        number.value = value === null || value === undefined ? "" : String(value);
        fire(number, "input");
        return true;
    }

    const textarea = row.querySelector("textarea.admin-field-input-text");
    if (textarea) {
        textarea.value = Array.isArray(value)
            ? value.map((item) => JSON.stringify(item)).join("\n")
            : (value === null || value === undefined ? "" : String(value));
        fire(textarea, "input");
        return true;
    }

    const text = row.querySelector("input.admin-field-input[type='text']");
    if (text) {
        text.value = value === null || value === undefined ? "" : String(value);
        fire(text, "input");
        return true;
    }

    return false;
}

function buildButton(row, value) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-field-reset-btn";
    btn.textContent = "⟲";
    btn.setAttribute("aria-label", "Reset to default");
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyValue(row, value);
    });
    return btn;
}

export default function init(root, elementConfig) {
    const containerEl = root.querySelector("#ej-container");
    if (!containerEl) return;

    const target = normalizeTarget(elementConfig);
    const rootKeys = ROOT_KEY_HINTS[target] || ["", "master", "theme", "defaults"];

    let defaults = null;
    let frame = null;

    function decorate() {
        if (!defaults) return;

        for (const row of containerEl.querySelectorAll(".admin-field-row")) {
            if (row.dataset.resetWired === "1") continue;

            const segments = pathSegmentsFor(row, containerEl);
            if (!segments) continue;

            const key = segments[segments.length - 1];
            if (isSkippedRow(row, key)) {
                row.dataset.resetWired = "1";
                continue;
            }

            const value = resolveDefault(defaults, rootKeys, segments);
            row.dataset.resetWired = "1";

            if (value === undefined) continue;
            if (value !== null && typeof value === "object" && !Array.isArray(value)) continue;

            row.appendChild(buildButton(row, value));
        }
    }

    function schedule() {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            decorate();
        });
    }

    loadDefaults().then((data) => {
        defaults = data;
        decorate();
    });

    const observer = new MutationObserver(schedule);
    observer.observe(containerEl, { childList: true, subtree: true });
}