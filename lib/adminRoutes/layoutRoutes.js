const fs = require("fs");
const { ADMIN_LAYOUT_PATH, ADMIN_ELEMENTS_DIR, PANEL_EDITOR_ELEMENT_NAME } = require("./constants");
const { sendJson, readJsonBody, writeJsonFileAtomic } = require("./shared");
const { invalidateStat } = require("../fsCache");

// Lists every valid element folder under ADMIN/elements/ — i.e. everything
// the Panel Layout editor can offer to place into a column. "lib" is the
// shared core (css/json.js) folder, never a real panel, so it's always
// excluded. A folder only counts as a real element if it actually has an
// element.html to render — matches exactly what admin.js's loadElementInto
// requires to succeed.
function listElementNames() {
    let entries;
    try {
        entries = fs.readdirSync(ADMIN_ELEMENTS_DIR, { withFileTypes: true });
    } catch {
        return [];
    }

    return entries
        .filter((entry) => entry.isDirectory() && entry.name !== "lib")
        .filter((entry) => fs.existsSync(require("path").join(ADMIN_ELEMENTS_DIR, entry.name, "element.html")))
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

// Guarantees the Panel Layout editor itself (PANEL_EDITOR_ELEMENT_NAME) is
// always present somewhere in `columns` — so it's never possible to lock
// yourself out of the one panel that lets you fix the layout. If it's
// missing entirely, it's inserted as the very first item of the first
// column (creating that column if `columns` is empty). Returns a NEW
// columns array; never mutates the one passed in. `columns` is assumed to
// already be an array of arrays of strings (callers normalize/validate
// before calling this).
function ensurePanelEditorPresent(columns) {
    const alreadyPresent = columns.some((col) => col.includes(PANEL_EDITOR_ELEMENT_NAME));
    if (alreadyPresent) return columns;

    const result = columns.length > 0 ? columns.map((col) => [...col]) : [[]];
    result[0] = [PANEL_EDITOR_ELEMENT_NAME, ...result[0]];
    return result;
}

async function handleLayoutRoutes(req, res, safePath, method) {
    // Layout is self-healed on every read (page load) as well as on save
    // (see the PUT handler below) — see ensurePanelEditorPresent()'s
    // comment for why. Reading here never writes back to disk by itself;
    // it just guarantees what's SERVED always includes the layout editor,
    // so even a master.json edited/broken outside the UI can't lock you
    // out on the very next page load.
    if (safePath === "/api/layout" && method === "GET") {
        try {
            const raw = JSON.parse(fs.readFileSync(ADMIN_LAYOUT_PATH, "utf-8"));
            const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
            const cleanedColumns = rawColumns.map((col) =>
                Array.isArray(col) ? col.filter((name) => typeof name === "string" && name.trim() !== "") : []
            );
            const columns = ensurePanelEditorPresent(cleanedColumns);
            sendJson(res, 200, { ...raw, columns });
        } catch (e) {
            sendJson(res, 500, { error: `Failed to read admin layout: ${e.message}` });
        }
        return true;
    }

    // ── Panel Layout editor — save the column/element arrangement ────────────
    // Body: { columns: [[elementFolderName, ...], ...] }. Validates shape
    // only (array of arrays of non-empty strings) — an element name that no
    // longer exists on disk is still saved as-is (just logged), rather than
    // silently dropped, since the folder might come back or this might be
    // edited ahead of adding it. ALSO guarantees the Panel Layout editor
    // itself is present (see ensurePanelEditorPresent) before writing, so
    // even a save made by dragging it out of every column can't lock
    // anyone out — it's silently reinserted at the front of column 1.
    if (safePath === "/api/layout" && method === "PUT") {
        try {
            const data = await readJsonBody(req);
            if (!data || typeof data !== "object" || !Array.isArray(data.columns)) {
                sendJson(res, 400, { error: "Body must be an object with a \"columns\" array" });
                return true;
            }

            const validNames = new Set(listElementNames());
            const cleanedColumns = data.columns.map((col) => {
                if (!Array.isArray(col)) return [];
                return col.filter((name) => typeof name === "string" && name.trim() !== "");
            });

            for (const col of cleanedColumns) {
                for (const name of col) {
                    if (!validNames.has(name)) {
                        console.warn(`[admin] layout references unknown element "${name}" — saving anyway`);
                    }
                }
            }

            const finalColumns = ensurePanelEditorPresent(cleanedColumns);
            if (finalColumns !== cleanedColumns) {
                console.warn(`[admin] layout was missing "${PANEL_EDITOR_ELEMENT_NAME}" — reinserted at column 1 to avoid getting locked out`);
            }

            writeJsonFileAtomic(ADMIN_LAYOUT_PATH, { columns: finalColumns });
            invalidateStat(ADMIN_LAYOUT_PATH);
            sendJson(res, 200, { ok: true, columns: finalColumns });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    // ── Element list — every real panel folder under ADMIN/elements/, for
    // the Panel Layout editor's "Available Elements" list.
    if (safePath === "/api/element-list" && method === "GET") {
        try {
            sendJson(res, 200, { elements: listElementNames() });
        } catch (e) {
            sendJson(res, 500, { error: `Failed to list elements: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleLayoutRoutes, listElementNames, ensurePanelEditorPresent };
