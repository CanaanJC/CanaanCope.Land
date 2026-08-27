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

// Includes "hidden" so the frontend (topbar.js / mobile.js) can actually
// filter it out of nav dropdowns. Direct link access is never affected
// either way (routing matches by `path` only, see getLibraryByPath below —
// hidden is purely a nav-visibility concern).
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

// ── Custom font resolution ───────────────────────────────────────────────────
//
// Each theme section's "font" field is either "" (off) or a path RELATIVE
// TO public/ (same convention as media/logo.png, theme.topbar.icon, etc. —
// normally "fonts/MyFont.woff2", but any public/-relative path works)
// pointing at a .otf/.ttf/.woff/.woff2 file.
//
// Anything that doesn't resolve to a real file with one of the 4 allowed
// extensions silently falls back — never an error, never a broken page.

const FONT_EXT_FORMATS = {
    ".otf":   "opentype",
    ".ttf":   "truetype",
    ".woff":  "woff",
    ".woff2": "woff2",
};

// Resolves a single font path to { family, url, format }, or null if the
// path is empty/missing, has an unsupported extension, escapes PUBLIC_DIR,
// or doesn't exist on disk.
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

// ── Theme resolution (6-section model, "master overrides untouched fields") ──
//
// config/master.json's theme is split into 6 sections: master, topbar,
// sidebar, body, bottomText, code.
//
// Rule: theme.master OVERRIDES a field in any other section UNLESS that
// section's own value for that field has been explicitly customized away
// from what config/defaults.json ships for that exact field. In other
// words:
//   - section field is empty/missing, OR equals its own defaults.json
//     value  → treated as "never touched" → theme.master's value wins.
//   - section field differs from its own defaults.json value → the user
//     deliberately set it → that value wins over theme.master.
//   - if theme.master's own value is ALSO empty (nothing above master to
//     fall back to except the hardcoded CSS default) → resolves to null,
//     client-side CSS var() fallback applies (zero flash), same as before.
//
// This applies to backgroundColor / fontSize / textColor / font wherever a
// section defines them. Layout-only fields with no theme.master equivalent
// (topbar.depth, topbar.icon, sidebar.collapsedWidth/expandedWidth/iconSize,
// code's borderColor/blockBackgroundColor/blockBorderColor) are NOT subject
// to this override — they just use their own configured/defaulted value.

function numOrNull(v) {
    return (typeof v === "number" && !isNaN(v)) ? v : null;
}

function strOrNull(v) {
    return (typeof v === "string" && v.trim() !== "") ? v : null;
}

// Core override rule for a single field. `sectionVal`/`defaultVal` are the
// raw (possibly undefined) values straight from config; `masterVal` is
// theme.master's ALREADY-RESOLVED value for the equivalent field (string,
// number, or null).
function resolveWithMasterOverride(sectionVal, defaultVal, masterVal) {
    const isEmpty         = sectionVal === undefined || sectionVal === null || sectionVal === "";
    const matchesDefault  = !isEmpty && sectionVal === defaultVal;

    if (isEmpty || matchesDefault) {
        return masterVal; // untouched — master wins (or null, if master's own is empty too)
    }
    return sectionVal; // explicitly customized — this section's own value wins
}

// Resolves { backgroundColor, fontSize, textColor } for a section, applying
// resolveWithMasterOverride field-by-field against that section's own
// defaults.json values and theme.master's resolved values.
function resolveBasicFields(section, defaultsSection, masterResolved) {
    const s = section || {};
    const d = defaultsSection || {};
    return {
        backgroundColor: resolveWithMasterOverride(s.backgroundColor, d.backgroundColor, masterResolved.backgroundColor),
        fontSize:        resolveWithMasterOverride(s.fontSize,        d.fontSize,        masterResolved.fontSize),
        textColor:       resolveWithMasterOverride(s.textColor,       d.textColor,       masterResolved.textColor),
    };
}

// Same override rule, applied to a section's "font" path against
// theme.master's own (raw, not-yet-resolved-to-a-fontface) font path.
function resolveFontPath(section, defaultsSection, masterFontPath) {
    const s = section || {};
    const d = defaultsSection || {};
    return resolveWithMasterOverride(s.font, d.font, masterFontPath) || "";
}

// Builds both the resolved color/size payload ("theme") and the resolved
// @font-face descriptors ("fonts") sent to the client at /config/theme.json.
function buildThemePayload(theme, themeDefaults) {
    const t  = theme || {};
    const td = themeDefaults || {};

    const masterSection        = t.master || {};
    const masterDefaultsSection = td.master || {};

    // theme.master itself has nothing above it except the hardcoded CSS
    // default, so its own fields only ever fall back to null (never to
    // "defaults.json's master value") — same as before.
    const masterResolved = {
        backgroundColor: strOrNull(masterSection.backgroundColor),
        fontSize:        numOrNull(masterSection.fontSize),
        textColor:       strOrNull(masterSection.textColor),
    };
    const masterFontPath = strOrNull(masterSection.font) || "";

    const topbarSection         = t.topbar || {};
    const topbarDefaultsSection = td.topbar || {};
    const sloganSection         = topbarSection.slogan || {};
    const sloganDefaultsSection = topbarDefaultsSection.slogan || {};
    const sidebarSection        = t.sidebar || {};
    const sidebarDefaultsSection = td.sidebar || {};
    const bodySection           = t.body || {};
    const bodyDefaultsSection   = td.body || {};
    const bottomTextSection     = t.bottomText || {};
    const bottomTextDefaultsSection = td.bottomText || {};
    const codeSection           = t.code || {};
    const codeDefaultsSection   = td.code || {};

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

        body: resolveBasicFields(bodySection, bodyDefaultsSection, masterResolved),

        bottomText: resolveBasicFields(bottomTextSection, bottomTextDefaultsSection, masterResolved),

        code: {
            backgroundColor: resolveWithMasterOverride(codeSection.backgroundColor, codeDefaultsSection.backgroundColor, masterResolved.backgroundColor),
            textColor:       resolveWithMasterOverride(codeSection.textColor,       codeDefaultsSection.textColor,       masterResolved.textColor),
            fontSize:        resolveWithMasterOverride(codeSection.fontSize,        codeDefaultsSection.fontSize,        masterResolved.fontSize),
            // No theme.master equivalent for these — just their own configured/defaulted value.
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

// ── Homepage OG/embed injection ─────────────────────────────────────────────
//
// The homepage's <title> and embed are never hardcoded in the served output.
// At request time we:
//   1. Read "siteName" from config/master.json (via getSiteInfo()) — this is
//      now the primary source for the page <title>. If siteName is empty,
//      we fall back to whatever literal <title>…</title> content is
//      currently sitting in public/index.html on disk, so nothing breaks
//      for older configs.
//   2. Overwrite (or insert, if missing entirely) the <title>…</title> tag
//      in the HTML with that resolved title, so the browser tab / bookmark
//      name always matches config/master.json's "siteName" live — no
//      restart, no rebuilding index.html by hand.
//   3. Read "slogan" from config/master.json (via getSiteInfo()) for the
//      description.
//   4. Always point og:image / twitter:image at /media/logo.png.
//   5. Inject the Twemoji <script> tag into <head> — see injectTwemoji.
//
// If neither siteName nor a <title> tag can be found at all, OR <head>/
// </head> can't be found to inject into, NO embed tags (and no Twemoji
// tag) are added whatsoever and the <title> tag is left completely
// untouched — the page is served exactly as written on disk.

function extractTitle(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim() : null;
}

function buildHomepageOgBlock(title, origin) {
    const { slogan, siteName } = getSiteInfo();
    const description = slogan || "";
    const imageUrl     = `${origin}/media/logo.png`;
    const siteNameTag  = siteName
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
        return false; // no index.html on disk — fall through to normal static/404 handling
    }

    // siteName (config/master.json) wins as the page title. If it's empty
    // or missing, fall back to whatever <title>…</title> is literally
    // sitting in index.html on disk — same as before this change.
    const { siteName } = getSiteInfo();
    const fallbackTitle = extractTitle(html);
    const title = (siteName && siteName.trim()) ? siteName.trim() : fallbackTitle;

    if (title && /<head[^>]*>/i.test(html) && /<\/head>/i.test(html)) {
        if (/<title>[\s\S]*?<\/title>/i.test(html)) {
            // Existing <title> tag — overwrite its contents.
            html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escape(title)}</title>`);
        } else {
            // No <title> tag at all — insert one right after the opening
            // <head> tag, so the browser tab/bookmark name still resolves
            // correctly even if index.html never had one on disk.
            html = html.replace(/<head([^>]*)>/i, `<head$1>\n    <title>${escape(title)}</title>`);
        }

        const origin  = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
        const ogBlock = buildHomepageOgBlock(title, origin);
        html = html.replace(/<\/head>/i, `${ogBlock}  </head>`);
    }
    // If there's no resolvable title at all, or no <head>/</head> to
    // inject into, html is left completely untouched — served as-is,
    // with no embed tags and no <title> insertion.

    // Twemoji injection runs regardless of whether the OG block above
    // applied — as long as there's a </head> to inject before at all.
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

// Returns true if the request was fully handled.
function handleRoutes(req, res, safePath, stdHeaders) {
    // ── Homepage — dynamic OG/embed injection (see block above) ─────────────
    if ((safePath === "/" || safePath === "/index.html") && (req.method === "GET" || req.method === "HEAD")) {
        if (serveHomepageWithEmbed(req, res, stdHeaders)) return true;
    }

    // ── Libraries config (public subset) — drives topbar library dropdown ────
    if (safePath === "/config/libraries.json") {
        const list = getLibraries().map(toPublicLibrary);
        sendJson(res, stdHeaders, JSON.stringify(list), "public, max-age =60");
        return true;
    }

    // ── Theme config (public subset) — drives theme.js + topbar.js ──────────
    // "theme" carries the 6-section, fully resolved payload — each
    // section's backgroundColor/fontSize/textColor/font is overridden by
    // theme.master UNLESS the section's own value has been explicitly
    // customized away from its own defaults.json default (see
    // buildThemePayload above for the full rule). "fonts" carries the 6
    // resolved @font-face descriptors, or null for any that are off/
    // invalid — client-side CSS fallback (system-ui stack) takes over for
    // those.
    if (safePath === "/config/theme.json") {
        const { slogan, bottomText } = getSiteInfo();
        const rawTheme     = getTheme();
        const themeDefaults = getThemeDefaults();
        const favicon      = getFaviconUrl();
        const { theme, fonts } = buildThemePayload(rawTheme, themeDefaults);
        sendJson(res, stdHeaders, JSON.stringify({ favicon, slogan, bottomText, theme, fonts }), "public, max-age=60");
        return true;
    }

    // ── Notify config (public subset) — 404-page Discord webhook ──────────────
    if (safePath === "/config/notify.json") {
        const { notFound } = getWebhooks();
        sendJson(res, stdHeaders, JSON.stringify({ discordWebhookUrl: notFound || "" }), "no-store");
        return true;
    }

    // ── Raw version.txt — used by public/js/credit.js to display the running
    // version alongside the "Site designed by" line. Served verbatim as
    // plain text (not JSON) since config/version.txt is itself a plain file.
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

    // ── About-me media listing — self-contained at public/aboutme/ ──────────
    // (content.md + media/ live together in one folder, mirroring a blog
    // entry's layout, per the aboutme consolidation.)
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

    // ── Archive viewer — public page + control endpoints for a backup UUID ──
    const archiveMatch = safePath.match(/^\/archive\/([0-9a-fA-F-]{36})(?:\/(start|kill|logs|heartbeat|status))?\/?$/);
    if (archiveMatch) {
        const uuid   = archiveMatch[1];
        const action = archiveMatch[2];
        const entry  = archiveManager.findManifestEntry(uuid);

        if (!entry) {
            send404(res, stdHeaders);
            return true;
        }

        // GET /archive/:uuid — the page itself
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

        // GET /archive/:uuid/status — non-invasive check, never starts or
        // resets anything. Used on page load to resume showing an already-
        // running instance after the tab was closed/reopened. Also carries
        // this backup's nextBackupAt, the absolute maxExpiresAt hard cutoff,
        // and whether this backup even has an admin.js (hasAdmin) so the
        // frontend can decide up front whether a second link is possible —
        // no error is ever shown, older backups just omit it.
        if (action === "status" && req.method === "GET") {
            const status = archiveManager.statusOf(uuid);
            sendJson(res, stdHeaders, JSON.stringify({
                ...(status || { status: "idle" }),
                nextBackupAt: entry.nextBackupAt || null,
                hasAdmin: archiveManager.hasAdminSupport(uuid),
            }));
            return true;
        }

        // GET /archive/:uuid/start — spins up the daughter server (idempotent —
        // if one's already running for this uuid, just returns its info).
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

        // GET /archive/:uuid/kill
        if (action === "kill" && req.method === "GET") {
            const killed = archiveManager.killInstance(uuid);
            sendJson(res, stdHeaders, JSON.stringify({ killed }));
            return true;
        }

        // GET /archive/:uuid/heartbeat — resets the idle timer. Sent only
        // while the control page itself is open (page-side pinging, nothing
        // to do with the archived node server's own traffic).
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

        // GET /archive/:uuid/logs — Server-Sent Events stream
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

        return false; // unmatched action verb/method — fall through
    }

    // ── Library-driven routes ─────────────────────────────────────────────────
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

                const folderPath = path.join(PUBLIC_DIR, library.path, ...slugParts, "media", folder);
                sendJson(res, stdHeaders, JSON.stringify(listSupportedMedia(folderPath)));
                return true;
            }

            if (rest.length === library.depth && rest.every(isSafeSegment)) {
                const configPath = path.join(PUBLIC_DIR, library.path, ...rest, "config.json");
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

    return false; // no route matched — fall through to static file serving
}

module.exports = { handleRoutes };
