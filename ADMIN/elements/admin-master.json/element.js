// ─────────────────────────────────────────────────────────────────────────────
// Panel Layout editor — replaces the old generic json.js-based raw "columns"
// array editor. Lets you pick how many columns the admin page has (1-5) and
// drag elements (folder names from ADMIN/elements/) into them, in any order,
// with duplicates allowed.
//
// Talks directly to /api/layout (GET/PUT) and /api/element-list —
// completely independent of the shared json.js engine. This element's HTML
// deliberately has no #ej-container/#ej-save/etc., so json.js's
// initJsonEditor() just no-ops on it (see its own early-return guard for
// elements that don't have that shape) and this file's own init() does all
// the real work.
//
// Every mutation (column count change, drag/drop insert/move, chip removal)
// always ends by calling render() — so that's also the single choke point
// used to clear a stale "Saved." status message the moment anything changes
// after a save (see the top of render() below).
// ─────────────────────────────────────────────────────────────────────────────

const MIN_COLUMNS = 1;
const MAX_COLUMNS = 5;

let nextId = 1;

export default function init(root) {
    const columnCountEl   = root.querySelector("#le-column-count");
    const availableListEl = root.querySelector("#le-available-list");
    const columnsEl       = root.querySelector("#le-columns");
    const saveBtn         = root.querySelector("#le-save");
    const statusEl        = root.querySelector("#le-status");

    let availableNames = [];       // ["archive", "topbar.json", ...]
    let columns = [[]];            // [[{id,name}, ...], ...]

    function setStatus(text, kind) {
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    // Clears the status line the moment ANY edit happens, but only if it's
    // currently showing the "Saved." (ok) message — mirrors json.js's
    // notifyEdit(). Called at the top of render() rather than being
    // threaded through every individual mutation function, since every
    // mutation in this file always ends in a render() call anyway.
    function clearSavedStatusIfEditing() {
        if (statusEl.classList.contains("admin-status--ok")) {
            setStatus("");
        }
    }

    // ── Column-count normalization ──────────────────────────────────────────
    // Clamps to [MIN_COLUMNS, MAX_COLUMNS]. Shrinking never deletes items —
    // anything in a column beyond the new count is appended, in order, onto
    // the new last column. Growing just appends empty columns.
    function resizeColumns(newCount) {
        const clamped = Math.max(MIN_COLUMNS, Math.min(MAX_COLUMNS, newCount));

        if (clamped < columns.length) {
            const overflow = columns.slice(clamped).flat();
            columns = columns.slice(0, clamped);
            columns[clamped - 1] = columns[clamped - 1].concat(overflow);
        } else {
            while (columns.length < clamped) columns.push([]);
        }

        columnCountEl.value = String(clamped);
        render();
    }

    // ── Locate an item anywhere in `columns` by its generated id ────────────
    function findById(id) {
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
            const itemIndex = columns[colIndex].findIndex((item) => item.id === id);
            if (itemIndex !== -1) {
                return { colIndex, itemIndex, item: columns[colIndex][itemIndex] };
            }
        }
        return null;
    }

    // ── Drop-position math — which index, inside a column, does this drag
    // currently sit above? Based on the vertical midpoint of each existing
    // chip — the standard approach for a simple vertical reorder list.
    function getDropIndex(containerEl, clientY) {
        const chips = [...containerEl.querySelectorAll(":scope > .le-chip")];
        for (let i = 0; i < chips.length; i++) {
            const rect = chips[i].getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            if (clientY < midpoint) return i;
        }
        return chips.length;
    }

    function insertNew(name, targetColIndex, dropIndex) {
        columns[targetColIndex].splice(dropIndex, 0, { id: nextId++, name });
    }

    function moveExisting(id, targetColIndex, dropIndex) {
        const loc = findById(id);
        if (!loc) return;

        columns[loc.colIndex].splice(loc.itemIndex, 1);

        let insertIndex = dropIndex;
        if (loc.colIndex === targetColIndex && loc.itemIndex < dropIndex) {
            insertIndex -= 1;
        }
        columns[targetColIndex].splice(insertIndex, 0, loc.item);
    }

    function removeById(id) {
        const loc = findById(id);
        if (!loc) return;
        columns[loc.colIndex].splice(loc.itemIndex, 1);
    }

    function parseDragPayload(e) {
        try {
            return JSON.parse(e.dataTransfer.getData("application/json"));
        } catch {
            return null;
        }
    }

    // ── Rendering ────────────────────────────────────────────────────────────

    function renderAvailableList() {
        availableListEl.innerHTML = "";

        if (availableNames.length === 0) {
            const empty = document.createElement("div");
            empty.className = "le-empty";
            empty.textContent = "No elements found in ADMIN/elements/.";
            availableListEl.appendChild(empty);
            return;
        }

        for (const name of availableNames) {
            const item = document.createElement("div");
            item.className = "le-avail-item";
            item.draggable = true;
            item.textContent = name;

            item.addEventListener("dragstart", (e) => {
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("application/json", JSON.stringify({ type: "new", name }));
            });

            availableListEl.appendChild(item);
        }
    }

    // Dropping a dragged-from-a-column chip back onto the available pane
    // removes it (a quick way to delete without hunting for the × button).
    // Dragging a fresh "new" item here is a no-op — it's already available.
    // Wired once, not per-render, since availableListEl itself never gets
    // replaced (only its children do).
    availableListEl.addEventListener("dragover", (e) => e.preventDefault());
    availableListEl.addEventListener("drop", (e) => {
        e.preventDefault();
        const payload = parseDragPayload(e);
        if (payload && payload.type === "move") {
            removeById(payload.id);
            render();
        }
    });

    function buildChip(item) {
        const chip = document.createElement("div");
        chip.className = "le-chip";
        chip.draggable = true;
        chip.dataset.id = String(item.id);

        const label = document.createElement("span");
        label.className = "le-chip-label";
        label.textContent = item.name;
        chip.appendChild(label);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "le-chip-remove";
        removeBtn.title = "Remove from this column";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
            removeById(item.id);
            render();
        });
        chip.appendChild(removeBtn);

        chip.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/json", JSON.stringify({ type: "move", id: item.id }));
        });

        return chip;
    }

    function renderColumns() {
        columnsEl.innerHTML = "";

        columns.forEach((colItems, colIndex) => {
            const colEl = document.createElement("div");
            colEl.className = "le-column";
            colEl.dataset.colIndex = String(colIndex);

            const heading = document.createElement("div");
            heading.className = "le-column-heading";
            heading.textContent = `Column ${colIndex + 1}`;
            colEl.appendChild(heading);

            const dropZone = document.createElement("div");
            dropZone.className = "le-column-dropzone";

            for (const item of colItems) {
                dropZone.appendChild(buildChip(item));
            }

            colEl.appendChild(dropZone);

            dropZone.addEventListener("dragover", (e) => {
                e.preventDefault();
                colEl.classList.add("le-column--dragover");
            });
            dropZone.addEventListener("dragleave", () => {
                colEl.classList.remove("le-column--dragover");
            });
            dropZone.addEventListener("drop", (e) => {
                e.preventDefault();
                colEl.classList.remove("le-column--dragover");

                const payload = parseDragPayload(e);
                if (!payload) return;

                const dropIndex = getDropIndex(dropZone, e.clientY);

                if (payload.type === "new") {
                    insertNew(payload.name, colIndex, dropIndex);
                } else if (payload.type === "move") {
                    moveExisting(payload.id, colIndex, dropIndex);
                }
                render();
            });

            columnsEl.appendChild(colEl);
        });
    }

    function render() {
        // Any call to render() means something changed (or the initial
        // load just finished, when the status is empty anyway) — clear a
        // stale "Saved." message before repainting.
        clearSavedStatusIfEditing();
        renderAvailableList();
        renderColumns();
    }

    // ── Load current state ──────────────────────────────────────────────────

    Promise.all([
        fetch("/api/element-list").then(r => r.json()),
        fetch("/api/layout").then(r => r.json()),
    ])
        .then(([elementListRes, layout]) => {
            if (elementListRes && elementListRes.error) throw new Error(elementListRes.error);
            if (layout && layout.error) throw new Error(layout.error);

            availableNames = Array.isArray(elementListRes.elements) ? elementListRes.elements : [];

            const rawColumns = Array.isArray(layout.columns) ? layout.columns : [];
            columns = rawColumns.length > 0
                ? rawColumns.map((col) => (Array.isArray(col) ? col : [])
                    .filter((name) => typeof name === "string" && name.trim() !== "")
                    .map((name) => ({ id: nextId++, name })))
                : [[]];

            resizeColumns(columns.length); // clamps into [1,5], sets the <select>, then renders
        })
        .catch((e) => {
            setStatus(`Failed to load: ${e.message}`, "error");
        });

    columnCountEl.addEventListener("change", () => {
        resizeColumns(parseInt(columnCountEl.value, 10) || MIN_COLUMNS);
    });

    saveBtn.addEventListener("click", () => {
        setStatus("Saving…");
        const payload = {
            columns: columns.map((col) => col.map((item) => item.name)),
        };

        fetch("/api/layout", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        })
            .then(r => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                setStatus("Saved. Reload the admin page to see the new layout take effect.", "ok");
            })
            .catch((e) => {
                setStatus(`Save failed: ${e.message}`, "error");
            });
    });
}
