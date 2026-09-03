const fs = require("fs");
const path = require("path");

const { PUBLIC_DIR } = require("./constants");
const { isSafeSegment, escape, injectTwemoji } = require("./utils");
const { fileExists, listSupportedMedia } = require("./fsCache");
const { getLibraryManifest } = require("./manifest");
const { getLibraries, getLibraryByPath, getSiteInfo, getTheme, getThemeDefaults, getWebhooks, CONFIG_DIR } = require("./siteConfig");
const { getFaviconUrl } = require("./favicon");
const { buildLibraryEmbedHtml } = require("./embed");
const archiveManager = require("./archiveManager");

function sendJson(res, stdHeaders, body, cacheControl = "no-store") {
    res.writeHead(200, {
        ...stdHeaders,
        "Content-Type":   "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control":  cacheControl,
    });
    res.end(body);
}

function sendJsonBadRequest(res, stdHeaders) {
    res.writeHead(400, { ...stdHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end("[]");
}

function toPublicLibrary(lib) {
    return {
        id:       lib.id || lib.path,
        name:     lib.name || lib.path,
        path:     lib.path,
        depth:    lib.depth,
        useDates: !!lib.useDates,
        icon:     lib.icon || null,
        hidden:   !!lib.hidden,
    };
}

function send404(res, stdHeaders) {
    const notFoundPath = path.join(PUBLIC_DIR, "404", "404.html");
    let html;
    try { html = fs.readFileSync(notFoundPath, "utf-8"); }
    catch { html = "404 Not Found"; }
    html = injectTwemoji(html);
    const body = Buffer.from(html, "utf-8");
    res.writeHead(404, {
        ...stdHeaders,
        "Content-Type":   "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control":  "no-store",
    });
    res.end(body);
}

const FONT_EXT_FORMATS = {
    ".otf":   "opentype",
    ".ttf":   "truetype",
    ".woff":  "woff",
    ".woff2": "woff2",
};

function resolveFontField(familyName, relPath) {
    if (typeof relPath !== "string" || relPath.trim() === "") return null;

    const ext    = path.extname(relPath).toLowerCase();
    const format = FONT_EXT_FORMATS[ext];
    if (!format) return null;

    const resolved    = path.resolve(PUBLIC_DIR, relPath);
    const rootWithSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
    if (resolved !== PUBLIC_DIR && !resolved.startsWith(rootWithSep)) return null;

    if (!fileExists(resolved)) return null;

    const urlPath = "/" + relPath.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent).join("/");

    return { family: familyName, url: urlPath, format };
}

function numOrNull(v) {
    return (typeof v === "number" && !isNaN(v)) ? v : null;
}

function strOrNull(v) {
    return (typeof v === "string" && v.trim() !== "") ? v : null;
}

function resolveWithMasterOverride(sectionVal, defaultVal, masterVal) {
    const isEmpty        = sectionVal === undefined || sectionVal === null || sectionVal === "";
    const matchesDefault = !isEmpty && sectionVal === defaultVal;

    if (isEmpty || matchesDefault) {
        return masterVal;
    }
    return sectionVal;
}

function resolveBasicFields(section, defaultsSection, masterResolved) {
    const s = section || {};
    const d = defaultsSection || {};
    return {
        backgroundColor: resolveWithMasterOverride(s.backgroundColor, d.backgroundColor, masterResolved.backgroundColor),
        fontSize:        resolveWithMasterOverride(s.fontSize,        d.fontSize,        masterResolved.fontSize),
        textColor:       resolveWithMasterOverride(s.textColor,       d.textColor,       masterResolved.textColor),
    };
}

function resolveTextOnlyFields(section, defaultsSection, masterResolved) {
    const s = section || {};
    const d = defaultsSection || {};
    return {
        fontSize:  resolveWithMasterOverride(s.fontSize,  d.fontSize,  masterResolved.fontSize),
        textColor: resolveWithMasterOverride(s.textColor, d.textColor, masterResolved.textColor),
    };
}

function resolveFontPath(section, defaultsSection, masterFontPath) {
    const s = section || {};
    const d = defaultsSection || {};
    return resolveWithMasterOverride(s.font, d.font, masterFontPath) || "";
}

function buildThemePayload(theme, themeDefaults) {
    const t  = theme || {};
    const td = themeDefaults || {};

    const masterSection         = t.master || {};
    const masterDefaultsSection = td.master || {};

    const masterResolved = {
        backgroundColor: strOrNull(masterSection.backgroundColor),
        fontSize:        numOrNull(masterSection.fontSize),
        textColor:       strOrNull(masterSection.textColor),
    };
    const masterFontPath = strOrNull(masterSection.font) || "";

    const topbarSection             = t.topbar || {};
    const topbarDefaultsSection     = td.topbar || {};
    const sloganSection             = topbarSection.slogan || {};
    const sloganDefaultsSection     = topbarDefaultsSection.slogan || {};
    const sidebarSection            = t.sidebar || {};
    const sidebarDefaultsSection    = td.sidebar || {};
    const bodySection               = t.body || {};
    const bodyDefaultsSection       = td.body || {};
    const bottomTextSection         = t.bottomText || {};
    const bottomTextDefaultsSection = td.bottomText || {};
    const codeSection               = t.code || {};
    const codeDefaultsSection       = td.code || {};

    const colorTheme = {
        master: masterResolved,

        topbar: {
            ...resolveBasicFields(topbarSection, topbarDefaultsSection, masterResolved),
            depth: typeof topbarSection.depth === "number" ? topbarSection.depth : 56,
            icon:  topbarSection.icon || "",
            slogan: resolveBasicFields(sloganSection, sloganDefaultsSection, masterResolved),
        },

        sidebar: {
            ...resolveBasicFields(sidebarSection, sidebarDefaultsSection, masterResolved),
            collapsedWidth: typeof sidebarSection.collapsedWidth === "number" ? sidebarSection.collapsedWidth : 64,
            expandedWidth:  typeof sidebarSection.expandedWidth  === "number" ? sidebarSection.expandedWidth  : 320,
            iconSize:       typeof sidebarSection.iconSize       === "number" ? sidebarSection.iconSize       : 36,
        },

        body: {
            ...resolveBasicFields(bodySection, bodyDefaultsSection, masterResolved),
            // Blog divider colour is body-specific (no master equivalent): use
            // the section value, fall back to the defaults value, else null so
            // the CSS built-in default (#2a2a2a) applies.
            dividerColor: strOrNull(bodySection.dividerColor) || strOrNull(bodyDefaultsSection.dividerColor) || null,
        },

        bottomText: resolveTextOnlyFields(bottomTextSection, bottomTextDefaultsSection, masterResolved),

        code: {
            backgroundColor: resolveWithMasterOverride(codeSection.backgroundColor, codeDefaultsSection.backgroundColor, masterResolved.backgroundColor),
            textColor:       resolveWithMasterOverride(codeSection.textColor,       codeDefaultsSection.textColor,       masterResolved.textColor),
            fontSize:        resolveWithMasterOverride(codeSection.fontSize,        codeDefaultsSection.fontSize,        masterResolved.fontSize),
            borderColor:          strOrNull(codeSection.borderColor),
            blockBackgroundColor: strOrNull(codeSection.blockBackgroundColor),
            blockBorderColor:     strOrNull(codeSection.blockBorderColor),
        },
    };

    const fonts = {
        body:       resolveFontField("custom-body-font",        resolveFontPath(bodySection, bodyDefaultsSection, masterFontPath)),
        topbar:     resolveFontField("custom-topbar-font",      resolveFontPath(topbarSection, topbarDefaultsSection, masterFontPath)),
        slogan:     resolveFontField("custom-slogan-font",      resolveFontPath(sloganSection, sloganDefaultsSection, masterFontPath)),
        sidebar:    resolveFontField("custom-sidebar-font",     resolveFontPath(sidebarSection, sidebarDefaultsSection, masterFontPath)),
        bottomText: resolveFontField("custom-bottom-text-font", resolveFontPath(bottomTextSection, bottomTextDefaultsSection, masterFontPath)),
        code:       resolveFontField("custom-code-font",        resolveFontPath(codeSection, codeDefaultsSection, masterFontPath)),
    };

    return { theme: colorTheme, fonts };
}

function extractTitle(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim() : null;
}

function buildHomepageOgBlock(title, origin) {
    const { slogan, siteName } = getSiteInfo();
    const description = slogan || "";
    const imageUrl    = `${origin}/media/logo.png`;
    const siteNameTag = siteName
        ? `\n    <meta property="og:site_name" content="${escape(siteName)}" />`
        : "";

    return `
    <meta name="description" content="${escape(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(description)}" />
    <meta property="og:url" content="${escape(origin + "/")}" />
    <meta property="og:image" content="${escape(imageUrl)}" />${siteNameTag}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(title)}" />
    <meta name="twitter:description" content="${escape(description)}" />
    <meta name="twitter:image" content="${escape(imageUrl)}" />
`;
}

function serveHomepageWithEmbed(req, res, stdHeaders) {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    let html;
    try {
        html = fs.readFileSync(indexPath, "utf-8");
    } catch {
        return false;
    }

    const { siteName } = getSiteInfo();
    const fallbackTitle = extractTitle(html);
    const title = (siteName && siteName.trim()) ? siteName.trim() : fallbackTitle;

    if (title && /<head[^>]*>/i.test(html) && /<\/head>/i.test(html)) {
        if (/<title>[\s\S]*?<\/title>/i.test(html)) {
            html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)}</title>`);
        } else {
            html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${escape(title)}</title>`);
        }

        const origin  = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
        const ogBlock = buildHomepageOgBlock(title, origin);
        html = html.replace(/<\/head>/i, `${ogBlock}  </head>`);
    }

    html = injectTwemoji(html);

    const body = Buffer.from(html, "utf-8");
    res.writeHead(200, {
        ...stdHeaders,
        "Content-Type":   "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control":  "no-store",
    });

    if (req.method === "HEAD") {
        res.end();
        return true;
    }
    res.end(body);
    return true;
}

function handleRoutes(req, res, safePath, stdHeaders) {
    if ((safePath === "/" || safePath === "/index.html") && (req.method === "GET" || req.method === "HEAD")) {
        if (serveHomepageWithEmbed(req, res, stdHeaders)) return true;
    }

    if (safePath === "/config/libraries.json") {
        const list = getLibraries().map(toPublicLibrary);
        sendJson(res, stdHeaders, JSON.stringify(list), "public, max-age =60");
        return true;
    }

    if (safePath === "/config/theme.json") {
        const { slogan, bottomText } = getSiteInfo();
        const rawTheme      = getTheme();
        const themeDefaults = getThemeDefaults();
        const favicon       = getFaviconUrl();
        const { theme, fonts } = buildThemePayload(rawTheme, themeDefaults);
        sendJson(res, stdHeaders, JSON.stringify({ favicon, slogan, bottomText, theme, fonts }), "public, max-age=60");
        return true;
    }

    if (safePath === "/config/notify.json") {
        const { notFound } = getWebhooks();
        sendJson(res, stdHeaders, JSON.stringify({ discordWebhookUrl: notFound || "" }), "no-store");
        return true;
    }

    if (safePath === "/config/version.txt") {
        const versionPath = path.join(CONFIG_DIR, "version.txt");
        let text = "";
        try { text = fs.readFileSync(versionPath, "utf-8").trim(); } catch { text = ""; }
        const body = Buffer.from(text, "utf-8");
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "text/plain; charset=utf-8",
            "Content-Length": body.length,
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return true;
    }

    const aboutMeListingMatch = safePath.match(/^\/aboutme\/media-listing\/([^\/]+)\/?$/);
    if (aboutMeListingMatch) {
        const folder = aboutMeListingMatch[1];
        if (!isSafeSegment(folder)) {
            sendJsonBadRequest(res, stdHeaders);
            return true;
        }
        const folderPath = path.join(PUBLIC_DIR, "aboutme", "media", folder);
        sendJson(res, stdHeaders, JSON.stringify(listSupportedMedia(folderPath)));
        return true;
    }

    const archiveMatch = safePath.match(/^\/archive\/([0-9a-fA-F-]{36})(?:\/(start|kill|logs|heartbeat|status))?\/?$/);
    if (archiveMatch) {
        const uuid   = archiveMatch[1];
        const action = archiveMatch[2];
        const entry  = archiveManager.findManifestEntry(uuid);

        if (!entry) {
            send404(res, stdHeaders);
            return true;
        }

        if (!action) {
            const archivePagePath = path.join(PUBLIC_DIR, "archive", "archive.html");
            let html;
            try { html = fs.readFileSync(archivePagePath, "utf-8"); }
            catch { html = "Archive viewer template missing"; }
            html = injectTwemoji(html);
            const body = Buffer.from(html, "utf-8");
            res.writeHead(200, {
                ...stdHeaders,
                "Content-Type":   "text/html; charset=utf-8",
                "Content-Length": body.length,
                "Cache-Control":  "no-store",
            });
            res.end(body);
            return true;
        }

        if (action === "status" && req.method === "GET") {
            const status = archiveManager.statusOf(uuid);
            sendJson(res, stdHeaders, JSON.stringify({
                ...(status || { status: "idle" }),
                nextBackupAt: entry.nextBackupAt || null,
                hasAdmin: archiveManager.hasAdminSupport(uuid),
            }));
            return true;
        }

        if (action === "start" && req.method === "GET") {
            archiveManager.startInstance(uuid)
                .then((instance) => {
                    sendJson(res, stdHeaders, JSON.stringify({
                        status: instance.status,
                        port: instance.port,
                        lanIp: instance.lanIp,
                        expiresAt: instance.expiresAt,
                        maxExpiresAt: instance.maxExpiresAt,
                        adminStatus: instance.adminStatus,
                        adminPort: instance.adminPort,
                        adminLanIp: instance.adminLanIp,
                    }));
                })
                .catch((err) => {
                    res.writeHead(500, { ...stdHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
                    res.end(JSON.stringify({ error: err.message }));
                });
            return true;
        }

        if (action === "kill" && req.method === "GET") {
            const killed = archiveManager.killInstance(uuid);
            sendJson(res, stdHeaders, JSON.stringify({ killed }));
            return true;
        }

        if (action === "heartbeat" && req.method === "GET") {
            archiveManager.resetIdleTimer(uuid);
            const status = archiveManager.statusOf(uuid);
            sendJson(res, stdHeaders, JSON.stringify({
                ok: true,
                expiresAt: status ? status.expiresAt : null,
                maxExpiresAt: status ? status.maxExpiresAt : null,
            }));
            return true;
        }

        if (action === "logs" && req.method === "GET") {
            res.writeHead(200, {
                ...stdHeaders,
                "Content-Type":  "text/event-stream",
                "Cache-Control": "no-store",
                "Connection":    "keep-alive",
            });

            const instance = archiveManager.getInstance(uuid);
            if (instance) {
                res.write(`data: ${JSON.stringify({ status: instance.status, adminStatus: instance.adminStatus })}\n\n`);
                for (const line of instance.logs) {
                    res.write(`data: ${JSON.stringify({ line })}\n\n`);
                }
            }

            const unsubscribe = archiveManager.subscribe(uuid, (line) => {
                if (line.startsWith("__STATUS__")) {
                    res.write(`data: ${JSON.stringify({ status: line.replace("__STATUS__", "") })}\n\n`);
                } else if (line.startsWith("__ADMIN_STATUS__")) {
                    res.write(`data: ${JSON.stringify({ adminStatus: line.replace("__ADMIN_STATUS__", "") })}\n\n`);
                } else {
                    res.write(`data: ${JSON.stringify({ line })}\n\n`);
                }
            });

            req.on("close", () => unsubscribe());
            return true;
        }

        return false;
    }

    const parts = safePath.split("/").filter(Boolean);
    if (parts.length > 0) {
        const library = getLibraryByPath(parts[0]);
        if (library) {
            const rest = parts.slice(1);

            if (rest.length === 1 && rest[0] === "manifest.json") {
                const manifest = getLibraryManifest(library);
                sendJson(res, stdHeaders, JSON.stringify(manifest));
                return true;
            }

            if (rest.length === library.depth + 2 && rest[library.depth] === "media-listing") {
                const slugParts = rest.slice(0, library.depth);
                const folder    = rest[library.depth + 1];

                if (!slugParts.every(isSafeSegment) || !isSafeSegment(folder)) {
                    sendJsonBadRequest(res, stdHeaders);
                    return true;
                }

                const folderPath = path.join(PUBLIC_DIR, "libraries", library.path, ...slugParts, "media", folder);
                sendJson(res, stdHeaders, JSON.stringify(listSupportedMedia(folderPath)));
                return true;
            }

            if (rest.length === library.depth && rest.every(isSafeSegment)) {
                const configPath = path.join(PUBLIC_DIR, "libraries", library.path, ...rest, "config.json");
                if (fileExists(configPath)) {
                    try {
                        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                        const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
                        const html   = buildLibraryEmbedHtml(library, rest, config, origin);
                        res.writeHead(200, {
                            ...stdHeaders,
                            "Content-Type":  "text/html; charset=utf-8",
                            "Cache-Control": "no-store",
                        });
                        res.end(html);
                        return true;
                    } catch (err) {
                        console.error(`Failed to build embed page for "${library.path}/${rest.join("/")}":`, err);
                    }
                }
            }
        }
    }

    return false;
}

module.exports = { handleRoutes };
