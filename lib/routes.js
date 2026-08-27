const fs = require("fs");
const path = require("path");

const { PUBLIC_DIR } = require("./constants");
const { isSafeSegment, escape } = require("./utils");
const { fileExists, listSupportedMedia } = require("./fsCache");
const { getLibraryManifest } = require("./manifest");
const { getLibraries, getLibraryByPath, getSiteInfo, getTheme, getWebhooks, CONFIG_DIR } = require("./siteConfig");
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
// filter it out of nav dropdowns. Previously this field was stripped here,
// so `hidden: true` in libraries.json had no visible effect at all — every
// library always showed up in the dropdown regardless of the flag. Direct
// link access was never affected either way (routing matches by `path`
// only, see getLibraryByPath below — hidden is purely a nav-visibility
// concern).
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
// config/master.json's theme.page.font / theme.topbar.slogan.font /
// theme.bottomText.font are each either "" (off — browser default, no
// font-family override at all) or a path RELATIVE TO public/ (same
// convention as media/logo.png, theme.topbar.icon, etc. — normally
// "fonts/MyFont.woff2", but any public/-relative path works) pointing at
// a .otf/.ttf/.woff/.woff2 file. Anything that doesn't resolve to a real
// file with one of those 4 extensions silently falls back to "off" — never
// an error, never a broken page.

const FONT_EXT_FORMATS = {
    ".otf":   "opentype",
    ".ttf":   "truetype",
    ".woff":  "woff",
    ".woff2": "woff2",
};

// Resolves a single font field to { family, url, format }, or null if the
// field is empty/missing, has an unsupported extension, escapes PUBLIC_DIR,
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

// The 3 user-configurable font fields. Each resolves independently — one
// can be "on" while the others stay "off".
function resolveThemeFonts(theme) {
    return {
        page:       resolveFontField("custom-page-font",       theme?.page?.font),
        slogan:     resolveFontField("custom-slogan-font",      theme?.topbar?.slogan?.font),
        bottomText: resolveFontField("custom-bottom-text-font", theme?.bottomText?.font),
    };
}

// ── Windows flag-emoji fix ───────────────────────────────────────────────────
//
// Windows' built-in emoji font (Segoe UI Emoji) ships with zero flag
// glyphs. This is hardcoded (not user-configurable) to look for exactly
// public/fonts/twemoji.woff2. If present, this is reported to the client so
// it can register a unicode-range-scoped @font-face covering just the flag
// codepoints (client-side detects Windows and applies it — see
// public/js/theme.js). If missing, this is simply null and Windows renders
// flags exactly as it does today — no error, no broken page either way.
const FLAG_FONT_REL_PATH = "fonts/twemoji.woff2";

function resolveFlagFont() {
    return resolveFontField("twemoji-flags", FLAG_FONT_REL_PATH);
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
//
// If neither siteName nor a <title> tag can be found at all, OR <head>/
// </head> can't be found to inject into, NO embed tags are added
// whatsoever and the <title> tag is left completely untouched — the page
// is served exactly as written on disk, with zero embed rather than a
// partial/guessed one.

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
    // "fonts" carries the 3 user-configurable resolved custom fonts (or null
    // per-field if off/invalid/missing). "flagFont" carries the hardcoded
    // Windows flag-emoji fix font (or null if public/fonts/twemoji.woff2
    // doesn't exist).
    if (safePath === "/config/theme.json") {
        const { slogan, bottomText } = getSiteInfo();
        const theme    = getTheme();
        const favicon  = getFaviconUrl();
        const fonts    = resolveThemeFonts(theme);
        const flagFont = resolveFlagFont();
        sendJson(res, stdHeaders, JSON.stringify({ favicon, slogan, bottomText, theme, fonts, flagFont }), "public, max-age=60");
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
