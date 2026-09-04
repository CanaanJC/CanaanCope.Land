

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
    function clearSavedStatusIfEditing() {
        if (statusEl.classList.contains("admin-status--ok")) {
            setStatus("");
        }
    }

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

    function findById(id) {
        for (let colIndex = 0; colIndex < columns.length; colIndex++) {
            const itemIndex = columns[colIndex].findIndex((item) => item.id === id);
            if (itemIndex !== -1) {
                return { colIndex, itemIndex, item: columns[colIndex][itemIndex] };
            }
        }
        return null;
    }
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

        renderAvailableList();
        renderColumns();
    }

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
