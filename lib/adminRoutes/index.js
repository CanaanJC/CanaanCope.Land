const { handleLayoutRoutes } = require("./layoutRoutes");
const { handleSiteConfigRoutes } = require("./siteConfigRoutes");
const { handleLibraryRoutes } = require("./libraryRoutes");
const { handleBlogRoutes } = require("./blogRoutes");
const { handleBlogMediaRoutes } = require("./blogMediaRoutes");
const { handleArchiveRoutes } = require("./archiveRoutes");
const { handleUploadRoutes } = require("./uploadRoutes");

// Dispatches every /api/* admin route to its own focused module. Order
// mirrors the original single-file implementation — since each module
// only ever matches its own distinct set of paths, the order between
// groups has no behavioral effect, only readability.
async function handleAdminRoutes(req, res, safePath) {
    const method = req.method || "GET";

    if (await handleLayoutRoutes(req, res, safePath, method)) return true;
    if (await handleSiteConfigRoutes(req, res, safePath, method)) return true;
    if (await handleLibraryRoutes(req, res, safePath, method)) return true;
    if (await handleBlogRoutes(req, res, safePath, method)) return true;
    if (await handleBlogMediaRoutes(req, res, safePath, method)) return true;
    if (await handleArchiveRoutes(req, res, safePath, method)) return true;
    if (await handleUploadRoutes(req, res, safePath, method)) return true;

    return false;
}

module.exports = { handleAdminRoutes };
