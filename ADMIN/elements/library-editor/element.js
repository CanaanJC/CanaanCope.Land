const FIELDS = [
    { key: "id",       label: "ID",         type: "text" },
    { key: "name",     label: "Name",       type: "text" },
    { key: "path",     label: "Path",       type: "text" },
    { key: "depth",    label: "Depth",      type: "number" },
    { key: "useDates", label: "Use Dates",  type: "checkbox" },
    { key: "icon",     label: "Icon",       type: "text" },
    { key: "hidden",   label: "Hidden",     type: "checkbox" },
];

// One shared overlay/modal per element instance — created once, reused for
// every delete confirmation rather than rebuilt each time.
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
    confirmBtn.textContent = "Delete";

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
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });

    confirmBtn.addEventListener("click", () => {
        if (onConfirm) onConfirm();
        close();
    });

    return {
        open(libName, callback) {
            message.textContent = `Are you sure you want to delete "${libName}"?`;
            onConfirm = callback;
            overlay.hidden = false;
        },
    };
}

export default function init(root) {
    const listEl   = root.querySelector("#le-list");
    const addBtn   = root.querySelector("#le-add");
    const saveBtn  = root.querySelector("#le-save");
    const statusEl = root.querySelector("#le-status");

    const confirmModal = createConfirmModal(root);

    let libraries = [];

    // The admin panel runs on a separate host/port from the public site, so
    // a relative "/<path>" link would just reload the admin panel itself.
    // Instead, library title links point at "<lanIp>:<hosting.port>/<path>",
    // fetched once up front from /api/config. If it can't be determined,
    // titles fall back to plain (non-link) text rather than linking
    // somewhere wrong.
    let linkBase = null; // e.g. "http://192.168.0.133:2138"

    function loadLinkBase() {
        return fetch("/api/config")
            .then(r => r.json())
            .then((config) => {
                const lanIp = config?.backup?.lanIp;
                const port  = config?.hosting?.port;
                if (lanIp && port) {
                    linkBase = `http://${lanIp}:${port}`;
                }
            })
            .catch((e) => {
                console.error("Library editor: failed to load lanIp/port for links:", e);
            });
    }

    // Builds the clickable link that sits in place of the plain title text.
    // Points at "<lanIp>:<hosting.port>/<path>" so clicking it from the
    // admin panel (a different host/port) jumps to that library's public
    // page. Falls back to a plain (non-link) span if path is empty or
    // linkBase couldn't be determined.
    function buildTitleEl(lib) {
        const label = lib.name || lib.path || "(unnamed library)";
        if (linkBase && lib.path && lib.path.trim() !== "") {
            const link = document.createElement("a");
            link.className = "admin-lib-title admin-lib-title--link";
            link.href = `${linkBase}/${lib.path}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = label;
            return link;
        }
        const span = document.createElement("span");
        span.className = "admin-lib-title";
        span.textContent = label;
        return span;
    }

    function buildCard(lib, onDelete) {
        const card = document.createElement("div");
        card.className = "admin-lib-card";

        const summary = document.createElement("div");
        summary.className = "admin-lib-summary";

        let title = buildTitleEl(lib);
        summary.appendChild(title);

        const actions = document.createElement("div");
        actions.className = "admin-lib-actions";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "admin-button admin-button--danger";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
            const displayName = lib.name || lib.path || "(unnamed library)";
            confirmModal.open(displayName, onDelete);
        });

        actions.appendChild(deleteBtn);
        summary.appendChild(actions);
        card.appendChild(summary);

        const fieldsWrap = document.createElement("div");
        fieldsWrap.className = "admin-lib-fields";

        for (const field of FIELDS) {
            const row = document.createElement("div");
            row.className = "admin-field-row";
            const label = document.createElement("label");
            label.className = "admin-field-label";
            label.textContent = field.label;
            row.appendChild(label);

            const input = document.createElement("input");
            input.className = "admin-field-input";

            if (field.type === "checkbox") {
                input.type = "checkbox";
                input.checked = !!lib[field.key];
                input.addEventListener("change", () => {
                    lib[field.key] = input.checked;
                });
            } else if (field.type === "number") {
                input.type = "number";
                input.value = lib[field.key] ?? "";
                input.addEventListener("input", () => {
                    lib[field.key] = input.valueAsNumber;
                });
            } else {
                input.type = "text";
                input.value = lib[field.key] ?? "";
                input.addEventListener("input", () => {
                    lib[field.key] = input.value;
                    if (field.key === "name" || field.key === "path") {
                        // Rebuild the title element in place (it may need to
                        // switch between a link and a plain span, or update
                        // its href/text) rather than just changing textContent.
                        const newTitle = buildTitleEl(lib);
                        summary.replaceChild(newTitle, title);
                        title = newTitle;
                    }
                });
            }

            row.appendChild(input);
            fieldsWrap.appendChild(row);
        }

        card.appendChild(fieldsWrap);
        return card;
    }

    function renderAll() {
        listEl.innerHTML = "";
        libraries.forEach((lib, index) => {
            const card = buildCard(lib, () => {
                libraries.splice(index, 1);
                renderAll();
            });
            listEl.appendChild(card);
        });
    }

    // Load the lanIp/port link base first, then the libraries list — this
    // guarantees the very first render already has correct links instead of
    // rendering plain-text titles and silently never upgrading them.
    loadLinkBase().then(() => {
        fetch("/api/libraries")
            .then(r => r.json())
            .then((data) => {
                libraries = Array.isArray(data) ? data : [];
                renderAll();
            })
            .catch((e) => {
                statusEl.textContent = `Failed to load libraries: ${e.message}`;
                statusEl.className = "admin-status admin-status--error";
            });
    });

    addBtn.addEventListener("click", () => {
        // hidden defaults to false (visible) for new libraries, matching
        // every other existing entry's default nav-visible behavior.
        libraries.push({ id: "", name: "", path: "", depth: 1, useDates: false, icon: "", hidden: false });
        renderAll();
    });

    saveBtn.addEventListener("click", () => {
        statusEl.textContent = "Saving…";
        statusEl.className = "admin-status";
        fetch("/api/libraries", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(libraries),
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
