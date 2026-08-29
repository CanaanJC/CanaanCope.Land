const { sendJson, readJsonBody } = require("./shared");
const { getLibrariesRaw, saveLibraries } = require("../siteConfig");

async function handleLibraryRoutes(req, res, safePath, method) {
    if (safePath === "/api/libraries" && method === "GET") {
        sendJson(res, 200, getLibrariesRaw());
        return true;
    }

    if (safePath === "/api/libraries" && method === "PUT") {
        try {
            const data = await readJsonBody(req);
            if (!Array.isArray(data)) {
                sendJson(res, 400, { error: "Libraries must be a JSON array" });
                return true;
            }
            const ok = saveLibraries(data);
            sendJson(res, ok ? 200 : 500, ok ? { ok: true } : { error: "Failed to write libraries.json" });
        } catch (e) {
            sendJson(res, 400, { error: `Invalid request: ${e.message}` });
        }
        return true;
    }

    return false;
}

module.exports = { handleLibraryRoutes };
