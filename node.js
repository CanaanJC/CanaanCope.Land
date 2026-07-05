const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "0.0.0.0";
const PORT = process.env.PORT ? Number(process.env.PORT) : 2138;
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm":  "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".mjs":  "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".webp": "image/webp",
    ".ico":  "image/x-icon",
    ".txt":  "text/plain; charset=utf-8",
    ".md":   "text/plain; charset=utf-8",
    ".wav":  "audio/wav",
    ".mp3":  "audio/mpeg",
    ".mp4":  "video/mp4",
    ".webm": "video/webm",
    ".pdf":  "application/pdf",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
    ".ttf":  "font/ttf",
    ".otf":  "font/otf",
};

const FOLDER_SUPPORTED = /\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav)$/i;

// ── Perf tuning constants ─────────────────────────────────────────────────────

const IMAGE_EXT_RE  = /^\.(png|jpg|jpeg|gif|webp|svg|ico)$/i;
const VIDEO_EXT_RE  = /^\.(mp4|webm)$/i;
const AUDIO_EXT_RE  = /^\.(mp3|wav)$/i;

// Larger buffers dramatically reduce syscall overhead for binary media.
// 64 KB (Node default) is fine for tiny text files but wastes throughput on media.
const HWM_IMAGE   = 512 * 1024;   // 512 KB
const HWM_AV      = 1024 * 1024;  // 1 MB
const HWM_DEFAULT = 64 * 1024;    // 64 KB

// TTL for the tiny in-process stat cache. Very short so edits still show up
// quickly, but long enough to collapse the flood of stat() calls that a single
// page load produces.
const STAT_TTL_MS = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

// Per-content-type Cache-Control. Media is treated as immutable since project
// media files are content-addressed by their path and don't change in place.
function getCacheControl(ext) {
    if (/^\.(png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|mp3|wav|woff|woff2|ttf|otf|wasm)$/i.test(ext)) {
        return "public, max-age=31536000, immutable";
    }
    if (/^\.(css|js|mjs)$/i.test(ext)) {
        return "public, max-age=3600";
    }
    if (/^\.(html|htm|json|md|txt|pdf)$/i.test(ext)) {
        return "public, max-age=60";
    }
    return "public, max-age=300";
}

// Weak ETag from file size + mtime — cheap and stable across restarts
function makeETag(stat) {
    return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

// Pick an appropriate read buffer size for a given file extension.
function pickHighWaterMark(ext) {
    if (IMAGE_EXT_RE.test(ext)) return HWM_IMAGE;
    if (VIDEO_EXT_RE.test(ext) || AUDIO_EXT_RE.test(ext)) return HWM_AV;
    return HWM_DEFAULT;
}

// Determine whether a sanitized request path is the site root. Only the root
// document should remain indexable; everything else gets an X-Robots-Tag.
function isRootPath(safePath) {
    return safePath === "/" || safePath === "/index.html";
}

// Build the standard header set for a request. All non-root responses carry
// X-Robots-Tag: noindex, follow so sub-pages drop out of search indexes while
// still passing link equity through to the root.
function buildStdHeaders(safePath) {
    if (isRootPath(safePath)) return baseHeaders;
    return { ...baseHeaders, "X-Robots-Tag": "noindex, follow" };
}

// Tiny TTL-based stat cache to avoid re-stat'ing the same file dozens of times
// during a single burst of requests. Entries expire quickly so filesystem
// changes are picked up almost immediately.
const statCache = new Map();

function cachedStat(fsPath) {
    const now = Date.now();
    const hit = statCache.get(fsPath);
    if (hit && hit.expires > now) return hit.stat;

    let stat;
    try { stat = fs.statSync(fsPath); }
    catch { statCache.set(fsPath, { stat: null, expires: now + STAT_TTL_MS }); return null; }

    statCache.set(fsPath, { stat, expires: now + STAT_TTL_MS });
    return stat;
}

// Bound cache growth. Simple periodic prune.
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of statCache) {
        if (v.expires <= now) statCache.delete(k);
    }
    // Hard cap
    if (statCache.size > 5000) {
        const excess = statCache.size - 5000;
        let i = 0;
        for (const k of statCache.keys()) {
            if (i++ >= excess) break;
            statCache.delete(k);
        }
    }
}, 10000).unref();

// Parse a Range header. Returns { start, end } or null if invalid/unsupported.
function parseRange(rangeHeader, size) {
    if (!rangeHeader) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m) return null;
    const hasStart = m[1] !== "";
    const hasEnd   = m[2] !== "";
    let start, end;
    if (!hasStart && !hasEnd) return null;
    if (!hasStart) {
        // Suffix range: last N bytes
        const suffix = parseInt(m[2], 10);
        if (isNaN(suffix) || suffix <= 0) return null;
        start = Math.max(0, size - suffix);
        end   = size - 1;
    } else {
        start = parseInt(m[1], 10);
        end   = hasEnd ? parseInt(m[2], 10) : size - 1;
    }
    if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= size) return null;
    return { start, end };
}

function sanitizePath(urlPath) {
    const cleanPath = urlPath.split("?")[0].split("#")[0];
    let decoded;
    try { decoded = decodeURIComponent(cleanPath); }
    catch { return "/"; }
    const normalized = path.posix.normalize(decoded);
    if (normalized.includes("..")) return "/";
    return normalized;
}

function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function fileExists(filePath) {
    const s = cachedStat(filePath);
    return s ? s.isFile() : false;
}

function dirExists(dirPath) {
    const s = cachedStat(dirPath);
    return s ? s.isDirectory() : false;
}

function escape(str) {
    return String(str)
        .replace(/&/g,  "&amp;")
        .replace(/"/g,  "&quot;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;");
}

function isSafeSegment(seg) {
    return typeof seg === "string" &&
        seg.length > 0 &&
        !seg.includes("/") &&
        !seg.includes("\\") &&
        !seg.includes("..") &&
        seg !== ".";
}

// Base headers shared by every response. Cache-Control is NOT here — it's
// applied per response based on content type or endpoint semantics.
const baseHeaders = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer-when-downgrade",
    "Keep-Alive": "timeout=60",
    "Connection": "keep-alive",
};

// ── Project manifest ──────────────────────────────────────────────────────────

function getProjectManifest(section) {
    const sectionDir = path.join(PUBLIC_DIR, section);
    if (!dirExists(sectionDir)) return [];

    return fs.readdirSync(sectionDir)
        .filter(entry => {
            const entryPath = path.join(sectionDir, entry);
            const s = cachedStat(entryPath);
            if (!s || !s.isDirectory()) return false;
            return fileExists(path.join(entryPath, "config.json"));
        })
        .map(slug => {
            const configPath = path.join(sectionDir, slug, "config.json");
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                return {
                    slug,
                    name:        config.name        || slug,
                    date:        config.date        || null,
                    description: config.description || "",
                    featured:    config.featured    || false,
                    block:       config.block       || false,
                };
            } catch {
                return { slug, name: slug, date: null, description: "", featured: false, block: false };
            }
        })
        .filter(p => !p.block);
}

// ── Project embed HTML ────────────────────────────────────────────────────────

function buildProjectEmbedHtml(slug, config, origin, section) {
    const title       = escape(config.name        || slug);
    const description = escape(config.description || "");
    const url         = `${origin}/${section}/${slug}`;

    const mediaDir = path.join(PUBLIC_DIR, section, slug, "media");
    let imageTag = "";

    if (dirExists(mediaDir)) {
        const thumbPng = path.join(mediaDir, "thumb.png");
        const thumbMp4 = path.join(mediaDir, "thumb.mp4");

        if (fileExists(thumbPng)) {
            const imgUrl = `${origin}/${section}/${slug}/media/thumb.png`;
            imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;

        } else if (fileExists(thumbMp4)) {
            const vidUrl = `${origin}/${section}/${slug}/media/thumb.mp4`;
            imageTag = `
    <meta property="og:video" content="${escape(vidUrl)}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta name="twitter:card" content="player" />
    <meta name="twitter:player" content="${escape(vidUrl)}" />`;

        } else {
            const images = fs.readdirSync(mediaDir)
                .filter(f => {
                    if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(f)) return false;
                    const s = cachedStat(path.join(mediaDir, f));
                    return s && s.isFile();
                })
                .sort(naturalSort);

            if (images.length > 0) {
                const imgUrl = `${origin}/${section}/${slug}/media/${images[0]}`;
                imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
            } else {
                imageTag = `
    <meta name="twitter:card" content="summary" />`;
            }
        }
    }

    if (!imageTag) {
        imageTag = `
    <meta name="twitter:card" content="summary" />`;
    }

    if (config.block) {
        return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:type" content="article" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${imageTag}
    <link rel="stylesheet" href="/css/main.css" />
    <link rel="stylesheet" href="/css/lib-blog.css" />
    <link rel="stylesheet" href="/css/projects.css" />
  </head>
  <body>
    <main id="content" aria-label="${title}">
      <div id="projects-container"></div>
    </main>
    <script>
      window.__BLOCKED_SLUG__    = ${JSON.stringify(slug)};
      window.__BLOCKED_SECTION__ = ${JSON.stringify(section)};
    </script>
    <script src="/js/projects.js" type="module"></script>
  </body>
</html>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:type" content="article" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${imageTag}
    <script>
      window.location.replace("/${section}#${slug}");
    </script>
  </head>
  <body></body>
</html>`;
}

// ── CrafTech helpers ──────────────────────────────────────────────────────────

function formatFolderName(slug) {
    return slug
        .replace(/^\d+[-_]/, "")
        .split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

function getCrafTechManifest() {
    const crafTechDir = path.join(PUBLIC_DIR, "CrafTech");
    if (!dirExists(crafTechDir)) return [];

    const entries = [];

    const majorFolders = fs.readdirSync(crafTechDir)
        .filter(entry => {
            const entryPath = path.join(crafTechDir, entry);
            const s = cachedStat(entryPath);
            return s && s.isDirectory() && /^\d+/.test(entry);
        })
        .sort(naturalSort);

    for (const majorSlug of majorFolders) {
        const majorNum = parseInt(majorSlug, 10);
        const majorDir = path.join(crafTechDir, majorSlug);

        const subFolders = fs.readdirSync(majorDir)
            .filter(entry => {
                const entryPath = path.join(majorDir, entry);
                const s = cachedStat(entryPath);
                if (!s || !s.isDirectory()) return false;
                if (!/^\d+/.test(entry)) return false;
                return fileExists(path.join(entryPath, "config.json"));
            })
            .sort(naturalSort);

        for (const subSlug of subFolders) {
            const subNum = parseInt(subSlug, 10);
            const configPath = path.join(majorDir, subSlug, "config.json");
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                if (config.block) continue;
                entries.push({
                    majorSlug,
                    majorNum,
                    majorName: formatFolderName(majorSlug),
                    subSlug,
                    subNum,
                    name:        config.name        || subSlug,
                    description: config.description || "",
                    featured:    config.featured    || false,
                    block:       false,
                });
            } catch {
                entries.push({
                    majorSlug,
                    majorNum,
                    majorName: formatFolderName(majorSlug),
                    subSlug,
                    subNum,
                    name:        subSlug,
                    description: "",
                    featured:    false,
                    block:       false,
                });
            }
        }
    }

    return entries;
}

function buildCrafTechEmbedHtml(majorSlug, subSlug, config, origin) {
    const title       = escape(config.name        || subSlug);
    const description = escape(config.description || "");
    const url         = `${origin}/CrafTech/${encodeURIComponent(majorSlug)}/${encodeURIComponent(subSlug)}`;
    const anchorId    = `${majorSlug}--${subSlug}`;

    const mediaDir = path.join(PUBLIC_DIR, "CrafTech", majorSlug, subSlug, "media");
    let imageTag = "";

    if (dirExists(mediaDir)) {
        const thumbPng = path.join(mediaDir, "thumb.png");
        const thumbMp4 = path.join(mediaDir, "thumb.mp4");

        if (fileExists(thumbPng)) {
            const imgUrl = `${origin}/CrafTech/${encodeURIComponent(majorSlug)}/${encodeURIComponent(subSlug)}/media/thumb.png`;
            imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;

        } else if (fileExists(thumbMp4)) {
            const vidUrl = `${origin}/CrafTech/${encodeURIComponent(majorSlug)}/${encodeURIComponent(subSlug)}/media/thumb.mp4`;
            imageTag = `
    <meta property="og:video" content="${escape(vidUrl)}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta name="twitter:card" content="player" />
    <meta name="twitter:player" content="${escape(vidUrl)}" />`;

        } else {
            const images = fs.readdirSync(mediaDir)
                .filter(f => {
                    if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(f)) return false;
                    const s = cachedStat(path.join(mediaDir, f));
                    return s && s.isFile();
                })
                .sort(naturalSort);

            if (images.length > 0) {
                const imgUrl = `${origin}/CrafTech/${encodeURIComponent(majorSlug)}/${encodeURIComponent(subSlug)}/media/${encodeURIComponent(images[0])}`;
                imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
            } else {
                imageTag = `
    <meta name="twitter:card" content="summary" />`;
            }
        }
    }

    if (!imageTag) {
        imageTag = `
    <meta name="twitter:card" content="summary" />`;
    }

    if (config.block) {
        return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:type" content="article" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${imageTag}
    <link rel="stylesheet" href="/css/main.css" />
    <link rel="stylesheet" href="/css/lib-blog.css" />
    <link rel="stylesheet" href="/css/CrafTech.css" />
  </head>
  <body>
    <header class="topbar" aria-label="Top navigation">
      <nav class="topbar-inner" id="topbarList" aria-label="Topbar list"></nav>
    </header>
    <main id="content" aria-label="${title}">
      <div id="projects-container"></div>
    </main>
    <aside class="sidebar sidebar--loading" aria-label="Quick links">
      <nav class="sidebar-inner" id="sidebarList" aria-label="Sidebar list"></nav>
    </aside>
    <script>
      window.__CRAFTECH_BLOCKED_MAJOR__ = ${JSON.stringify(majorSlug)};
      window.__CRAFTECH_BLOCKED_SUB__   = ${JSON.stringify(subSlug)};
    </script>
    <script src="/js/main.js" type="module"></script>
    <script src="/js/CrafTech.js" type="module"></script>
  </body>
</html>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:type" content="article" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${imageTag}
    <script>
      window.location.replace("/CrafTech#${anchorId}");
    </script>
  </head>
  <body></body>
</html>`;
}

// ── Directory listing helper (shared) ─────────────────────────────────────────

function listSupportedMedia(folderPath) {
    if (!dirExists(folderPath)) return [];
    return fs.readdirSync(folderPath)
        .filter(f => {
            if (!FOLDER_SUPPORTED.test(f)) return false;
            const s = cachedStat(path.join(folderPath, f));
            return s && s.isFile();
        })
        .sort(naturalSort);
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    if (!["GET", "HEAD"].includes(req.method || "")) {
        res.writeHead(405, {
            ...baseHeaders,
            "Content-Type": "text/plain",
            "Allow": "GET, HEAD",
            "Cache-Control": "no-store",
        });
        res.end("Method Not Allowed");
        return;
    }

    const safePath = sanitizePath(req.url || "/");

    // Standard header set for this request: every non-root path receives
    // X-Robots-Tag: noindex, follow so only the root domain stays indexed.
    const stdHeaders = buildStdHeaders(safePath);

    // ── Manifest — /:section/manifest.json ───────────────────────────────────
    const manifestMatch = safePath.match(/^\/(projects|small-projects)\/manifest\.json$/);
    if (manifestMatch) {
        const manifest = getProjectManifest(manifestMatch[1]);
        const body     = JSON.stringify(manifest);
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── CrafTech manifest ────────────────────────────────────────────────────
    if (safePath === "/CrafTech/manifest.json") {
        const manifest = getCrafTechManifest();
        const body     = JSON.stringify(manifest);
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── About-me media listing ────────────────────────────────────────────────
    const aboutMeListingMatch = safePath.match(/^\/about-me\/media-listing\/([^\/]+)\/?$/);
    if (aboutMeListingMatch) {
        const folder = aboutMeListingMatch[1];
        if (!isSafeSegment(folder)) {
            res.writeHead(400, { ...stdHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end("[]");
            return;
        }

        const folderPath = path.join(PUBLIC_DIR, "media", "about-me", folder);
        const files      = listSupportedMedia(folderPath);
        const body       = JSON.stringify(files);
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── Project media listing ────────────────────────────────────────────────
    const mediaListingMatch = safePath.match(
        /^\/(projects|small-projects)\/([^\/]+)\/media-listing\/([^\/]+)\/?$/
    );
    if (mediaListingMatch) {
        const section = mediaListingMatch[1];
        const slug    = mediaListingMatch[2];
        const folder  = mediaListingMatch[3];

        if (!isSafeSegment(slug) || !isSafeSegment(folder)) {
            res.writeHead(400, { ...stdHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end("[]");
            return;
        }

        const folderPath = path.join(PUBLIC_DIR, section, slug, "media", folder);
        const files      = listSupportedMedia(folderPath);
        const body       = JSON.stringify(files);
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── CrafTech media listing ────────────────────────────────────────────────
    const crafTechListingMatch = safePath.match(
        /^\/CrafTech\/([^\/]+)\/([^\/]+)\/media-listing\/([^\/]+)\/?$/
    );
    if (crafTechListingMatch) {
        const majorSlug = crafTechListingMatch[1];
        const subSlug   = crafTechListingMatch[2];
        const folder    = crafTechListingMatch[3];

        if (!isSafeSegment(majorSlug) || !isSafeSegment(subSlug) || !isSafeSegment(folder)) {
            res.writeHead(400, { ...stdHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" });
            res.end("[]");
            return;
        }

        const folderPath = path.join(PUBLIC_DIR, "CrafTech", majorSlug, subSlug, "media", folder);
        const files      = listSupportedMedia(folderPath);
        const body       = JSON.stringify(files);
        res.writeHead(200, {
            ...stdHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── Project slug page ────────────────────────────────────────────────────
    const slugMatch = safePath.match(/^\/(projects|small-projects)\/([^\/]+)\/?$/);
    if (slugMatch) {
        const section    = slugMatch[1];
        const slug       = slugMatch[2];
        const configPath = path.join(PUBLIC_DIR, section, slug, "config.json");

        if (isSafeSegment(slug) && fileExists(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
                const html   = buildProjectEmbedHtml(slug, config, origin, section);
                res.writeHead(200, {
                    ...stdHeaders,
                    "Content-Type":  "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(html);
                return;
            } catch (err) {
                console.error("Failed to build project embed page:", err);
            }
        }
    }

    // ── CrafTech slug page ────────────────────────────────────────────────────
    const crafTechSlugMatch = safePath.match(/^\/CrafTech\/([^\/]+)\/([^\/]+)\/?$/);
    if (crafTechSlugMatch) {
        const majorSlug  = crafTechSlugMatch[1];
        const subSlug    = crafTechSlugMatch[2];
        const configPath = path.join(PUBLIC_DIR, "CrafTech", majorSlug, subSlug, "config.json");

        if (isSafeSegment(majorSlug) && isSafeSegment(subSlug) && fileExists(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
                const html   = buildCrafTechEmbedHtml(majorSlug, subSlug, config, origin);
                res.writeHead(200, {
                    ...stdHeaders,
                    "Content-Type":  "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(html);
                return;
            } catch (err) {
                console.error("Failed to build CrafTech embed page:", err);
            }
        }
    }

    // ── Static file serving ───────────────────────────────────────────────────
    let fsPath = path.join(PUBLIC_DIR, safePath);

    // Guard against path traversal escaping PUBLIC_DIR
    if (!fsPath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { ...stdHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("403 Forbidden");
        return;
    }

    const initialStat = cachedStat(fsPath);
    if (!initialStat) {
        res.writeHead(404, { ...stdHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("404 Not Found");
        return;
    }

    let finalStat = initialStat;

    if (initialStat.isDirectory()) {
        const indexPath = path.join(fsPath, "index.html");
        const idxStat   = cachedStat(indexPath);
        if (idxStat && idxStat.isFile()) {
            fsPath    = indexPath;
            finalStat = idxStat;
        } else {
            res.writeHead(404, { ...stdHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
            res.end("404 Not Found");
            return;
        }
    } else if (!initialStat.isFile()) {
        res.writeHead(404, { ...stdHeaders, "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end("404 Not Found");
        return;
    }

    const ext          = path.extname(fsPath).toLowerCase();
    const mimeType     = getMimeType(fsPath);
    const cacheControl = getCacheControl(ext);
    const etag         = makeETag(finalStat);
    const lastModified = finalStat.mtime.toUTCString();
    const highWaterMark = pickHighWaterMark(ext);

    // Conditional request: If-None-Match → 304 Not Modified
    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
        res.writeHead(304, {
            ...stdHeaders,
            "ETag":          etag,
            "Cache-Control": cacheControl,
            "Last-Modified": lastModified,
        });
        res.end();
        return;
    }

    // Conditional request: If-Modified-Since → 304 Not Modified
    const ifModifiedSince = req.headers["if-modified-since"];
    if (ifModifiedSince) {
        const since = Date.parse(ifModifiedSince);
        if (!isNaN(since) && Math.floor(finalStat.mtimeMs / 1000) * 1000 <= since) {
            res.writeHead(304, {
                ...stdHeaders,
                "ETag":          etag,
                "Cache-Control": cacheControl,
                "Last-Modified": lastModified,
            });
            res.end();
            return;
        }
    }

    // Range request: respond with 206 Partial Content
    const range = parseRange(req.headers.range, finalStat.size);
    if (range) {
        res.writeHead(206, {
            ...stdHeaders,
            "Content-Type":   mimeType,
            "Content-Length": range.end - range.start + 1,
            "Content-Range":  `bytes ${range.start}-${range.end}/${finalStat.size}`,
            "Accept-Ranges":  "bytes",
            "ETag":           etag,
            "Cache-Control":  cacheControl,
            "Last-Modified":  lastModified,
        });

        if (req.method === "HEAD") {
            res.end();
            return;
        }

        const stream = fs.createReadStream(fsPath, {
            start: range.start,
            end:   range.end,
            highWaterMark,
        });
        stream.on("error", () => { try { res.destroy(); } catch {} });
        req.on("close", () => { stream.destroy(); });
        stream.pipe(res);
        return;
    }

    // Malformed Range header — respond 416
    if (req.headers.range && !range) {
        res.writeHead(416, {
            ...stdHeaders,
            "Content-Range":  `bytes */${finalStat.size}`,
            "Cache-Control": "no-store",
        });
        res.end();
        return;
    }

    // Full response
    res.writeHead(200, {
        ...stdHeaders,
        "Content-Type":   mimeType,
        "Content-Length": finalStat.size,
        "Accept-Ranges":  "bytes",
        "ETag":           etag,
        "Cache-Control":  cacheControl,
        "Last-Modified":  lastModified,
    });

    if (req.method === "HEAD") {
        res.end();
        return;
    }

    const stream = fs.createReadStream(fsPath, { highWaterMark });
    stream.on("error", () => { try { res.destroy(); } catch {} });
    req.on("close", () => { stream.destroy(); });
    stream.pipe(res);
});

// Encourage longer-lived sockets from upstream (Caddy) so it doesn't pay
// TCP/TLS setup cost repeatedly for each new request batch.
server.keepAliveTimeout = 65000;  // ms — must be > Caddy's keep-alive timeout
server.headersTimeout   = 70000;

// Bump max sockets / listeners — Node default of 10 event listeners on a
// single emitter can throttle high-concurrency image loads.
server.maxRequestsPerSocket = 0; // unlimited
server.requestTimeout       = 0; // disable per-request timeout (large media)

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving: ${PUBLIC_DIR}`);
});
