const fs = require("fs");
const { ADMIN_LAYOUT_PATH, ADMIN_ELEMENTS_DIR, PANEL_EDITOR_ELEMENT_NAME } = require("./constants");
const { sendJson, readJsonBody, writeJsonFileAtomic } = require("./shared");
const { invalidateStat } = require("../fsCache");

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

function ensurePanelEditorPresent(columns) {
    const alreadyPresent = columns.some((col) => col.includes(PANEL_EDITOR_ELEMENT_NAME));
    if (alreadyPresent) return columns;

    const result = columns.length > 0 ? columns.map((col) => [...col]) : [[]];
    result[0] = [PANEL_EDITOR_ELEMENT_NAME, ...result[0]];
    return result;
}

async function handleLayoutRoutes(req, res, safePath, method) {
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
