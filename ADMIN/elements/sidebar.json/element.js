// ─────────────────────────────────────────────────────────────────────────────
// Sidebar links editor.
//
// Edits the array-of-objects JSON file pointed to by this element's sibling
// config.json ("target", e.g. "public/json/sidebar.json"). Each entry is a
// { text, link, image } contact/social link. Mirrors the layout/behavior of
// the library-editor element — a card per entry with a Delete button, a
// "+ Add Link" button at the bottom to append a new blank entry, and a single
// Save button that writes the whole array back via /api/file.
//
// The Image field also has an upload button (mirrors the library-editor's
// icon uploader) — it requires the entry's Text field to be filled out
// first (used as the uploaded filename), and creates
// public/media/sidebar/ on demand if it doesn't exist yet.
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS = [
    { key: "text",  label: "Text",  type: "text" },
    { key: "link",  label: "Link",  type: "text" },
    { key: "image", label: "Image", type: "text" },
];

// One shared overlay/modal per element instance — created once, reused for
// every confirmation (delete OR overwrite) rather than rebuilt each time.
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
        // Back-compat convenience wrapper — matches the original
        // (itemName, callback) delete-confirm call shape.
        open(itemName, callback) {
            message.textContent = `Are you sure you want to delete "${itemName}"?`;
            confirmBtn.textContent = "Delete";
            confirmBtn.className = "admin-button admin-button--danger";
            onConfirm = callback;
            overlay.hidden = false;
        },
        // General-purpose version — lets callers set a custom message and
        // confirm-button label (e.g. "Overwrite" instead of "Delete").
        openCustom(messageText, confirmLabel, callback) {
            message.textContent = messageText;
            confirmBtn.textContent = confirmLabel;
            confirmBtn.className = "admin-button admin-button--danger";
            onConfirm = callback;
            overlay.hidden = false;
        },
    };
}

// Client-side mirror of the server's sanitizeAssetName() — used only to
// predict/display what the uploaded filename will be; the server is always
// the source of truth and re-sanitizes independently.
function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// `elementConfig` is this element's own sibling config.json, loaded and
// passed in by admin.js — { "target": "public/json/sidebar.json", "name": "Contact Info" }.
export default function init(root, elementConfig) {
    const titleEl   = root.querySelector("#sl-title");
    const listEl    = root.querySelector("#sl-list");
    const addBtn    = root.querySelector("#sl-add");
    const saveBtn   = root.querySelector("#sl-save");
    const statusEl  = root.querySelector("#sl-status");

    const targetPath = elementConfig && elementConfig.target;

    if (!targetPath) {
        statusEl.textContent = "Missing \"target\" in this element's config.json.";
        statusEl.className = "admin-status admin-status--error";
        return;
    }

    const displayName = elementConfig && typeof elementConfig.name === "string" && elementConfig.name.trim()
        ? elementConfig.name.trim()
        : targetPath;

    if (titleEl) titleEl.textContent = displayName;

    const confirmModal = createConfirmModal(root);

    let links = [];

    function buildCard(item, onDelete) {
        const card = document.createElement("div");
        card.className = "admin-lib-card";

        const summary = document.createElement("div");
        summary.className = "admin-lib-summary";

        const title = document.createElement("span");
        title.className = "admin-lib-title";
        title.textContent = item.text || "(unnamed link)";
        summary.appendChild(title);

        const actions = document.createElement("div");
        actions.className = "admin-lib-actions";

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "admin-button admin-button--danger";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
            const itemName = item.text || "(unnamed link)";
            confirmModal.open(itemName, onDelete);
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
            input.type = "text";
            input.className = "admin-field-input";
            input.value = item[field.key] ?? "";
            input.addEventListener("input", () => {
                item[field.key] = input.value;
                if (field.key === "text") {
                    title.textContent = item.text || "(unnamed link)";
                }
            });

            row.appendChild(input);

            // ── Image field gets an upload button + hidden file input ───
            // Requires the entry's Text field to be filled out first (used
            // as the uploaded filename), and creates public/media/sidebar/
            // on demand if it doesn't exist yet.
            if (field.key === "image") {
                const fileInput = document.createElement("input");
                fileInput.type = "file";
                fileInput.accept = "image/png";
                fileInput.hidden = true;

                const uploadBtn = document.createElement("button");
                uploadBtn.type = "button";
                uploadBtn.className = "admin-icon-upload-btn";
                uploadBtn.title = "Upload image PNG";
                uploadBtn.textContent = "⬆";

                const requireName = () => {
                    const linkName = (item.text || "").trim();
                    if (!linkName) {
                        alert("Please enter Text (the link name) before uploading an image.");
                        return null;
                    }
                    return linkName;
                };

                uploadBtn.addEventListener("click", () => {
                    if (!requireName()) return;
                    fileInput.click();
                });

                function doUpload(file, linkName, overwrite) {
                    file.arrayBuffer()
                        .then((buf) => {
                            const params = new URLSearchParams({ name: linkName });
                            if (overwrite) params.set("overwrite", "true");
                            return fetch(`/api/upload/sidebar?${params.toString()}`, {
                                method: "POST",
                                headers: { "Content-Type": file.type || "application/octet-stream" },
                                body: buf,
                            });
                        })
                        .then(async (res) => {
                            const data = await res.json().catch(() => ({}));
                            if (res.status === 409 && data.exists) {
                                const predicted = sanitizeAssetName(linkName);
                                confirmModal.openCustom(
                                    `A file already exists at "media/sidebar/${predicted}.png". Overwrite it?`,
                                    "Overwrite",
                                    () => doUpload(file, linkName, true)
                                );
                                return;
                            }
                            if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                            input.value = data.path;
                            item.image = data.path;
                        })
                        .catch((e) => {
                            alert(`Image upload failed: ${e.message}`);
                        });
                }

                fileInput.addEventListener("change", () => {
                    const file = fileInput.files[0];
                    fileInput.value = "";
                    if (!file) return;
                    const linkName = requireName();
                    if (!linkName) return;
                    doUpload(file, linkName, false);
                });

                row.appendChild(uploadBtn);
                row.appendChild(fileInput);
            }

            fieldsWrap.appendChild(row);
        }

        card.appendChild(fieldsWrap);
        return card;
    }

    function renderAll() {
        listEl.innerHTML = "";
        links.forEach((item, index) => {
            const card = buildCard(item, () => {
                links.splice(index, 1);
                renderAll();
            });
            listEl.appendChild(card);
        });
    }

    fetch(`/api/file?path=${encodeURIComponent(targetPath)}`)
        .then(r => r.json())
        .then((data) => {
            if (data && data.error) throw new Error(data.error);
            links = Array.isArray(data) ? data : [];
            renderAll();
        })
        .catch((e) => {
            statusEl.textContent = `Failed to load ${targetPath}: ${e.message}`;
            statusEl.className = "admin-status admin-status--error";
        });

    addBtn.addEventListener("click", () => {
        links.push({ text: "", link: "", image: "" });
        renderAll();
    });

    saveBtn.addEventListener("click", () => {
        statusEl.textContent = "Saving…";
        statusEl.className = "admin-status";
        fetch(`/api/file?path=${encodeURIComponent(targetPath)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(links),
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
