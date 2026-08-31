const { handleLayoutRoutes } = require("./layoutRoutes");
const { handleSiteConfigRoutes } = require("./siteConfigRoutes");
const { handleLibraryRoutes } = require("./libraryRoutes");
const { handleLibraryFsRoutes } = require("./libraryFsRoutes");
const { handleBlogRoutes } = require("./blogRoutes");
const { handleBlogMediaRoutes } = require("./blogMediaRoutes");
const { handleArchiveRoutes } = require("./archiveRoutes");
const { handleUploadRoutes } = require("./uploadRoutes");

async function handleAdminRoutes(req, res, safePath) {
    const method = req.method || "GET";

    if (await handleLayoutRoutes(req, res, safePath, method)) return true;
    if (await handleSiteConfigRoutes(req, res, safePath, method)) return true;
    if (await handleLibraryRoutes(req, res, safePath, method)) return true;
    if (await handleLibraryFsRoutes(req, res, safePath, method)) return true;
    if (await handleBlogRoutes(req, res, safePath, method)) return true;
    if (await handleBlogMediaRoutes(req, res, safePath, method)) return true;
    if (await handleArchiveRoutes(req, res, safePath, method)) return true;
    if (await handleUploadRoutes(req, res, safePath, method)) return true;

    return false;
}

module.exports = { handleAdminRoutes };
