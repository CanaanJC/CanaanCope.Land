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

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || "application/octet-stream";
}

function sanitizePath(urlPath) {
    const cleanPath = urlPath.split("?")[0].split("#")[0];
    const decoded = decodeURIComponent(cleanPath);
    const normalized = path.posix.normalize(decoded);
    if (normalized.includes("..")) return "/";
    return normalized;
}

function naturalSort(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function fileExists(filePath) {
    try { return fs.statSync(filePath).isFile(); }
    catch { return false; }
}

function escape(str) {
    return String(str)
        .replace(/&/g,  "&amp;")
        .replace(/"/g,  "&quot;")
        .replace(/</g,  "&lt;")
        .replace(/>/g,  "&gt;");
}

// ── Project manifest ──────────────────────────────────────────────────────────

function getProjectManifest(section) {
    const sectionDir = path.join(PUBLIC_DIR, section);
    if (!fs.existsSync(sectionDir)) return [];

    return fs.readdirSync(sectionDir)
        .filter(entry => {
            const entryPath = path.join(sectionDir, entry);
            if (!fs.statSync(entryPath).isDirectory()) return false;
            return fs.existsSync(path.join(entryPath, "config.json"));
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

    if (fs.existsSync(mediaDir)) {
        const thumbPng = path.join(mediaDir, "thumb.png");
        const thumbMp4 = path.join(mediaDir, "thumb.mp4");

        if (fs.existsSync(thumbPng)) {
            const imgUrl = `${origin}/${section}/${slug}/media/thumb.png`;
            imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;

        } else if (fs.existsSync(thumbMp4)) {
            const vidUrl = `${origin}/${section}/${slug}/media/thumb.mp4`;
            imageTag = `
    <meta property="og:video" content="${escape(vidUrl)}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta name="twitter:card" content="player" />
    <meta name="twitter:player" content="${escape(vidUrl)}" />`;

        } else {
            const images = fs.readdirSync(mediaDir)
                .filter(f =>
                    /\.(png|jpg|jpeg|webp|gif)$/i.test(f) &&
                    fs.statSync(path.join(mediaDir, f)).isFile()
                )
                .sort(naturalSort);

            if (images.length > 0) {
                const imgUrl = `${origin}/${section}/${slug}/media/${images[0]}`;
                imageTag = `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
            } else {
                imageTag = `\n    <meta name="twitter:card" content="summary" />`;
            }
        }
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
    <meta property="og:type" content="article" />${imageTag}
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
    <meta property="og:type" content="article" />${imageTag}
    <script>
      window.location.replace("/${section}#${slug}");
    </script>
  </head>
  <body></body>
</html>`;
}

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const baseHeaders = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer-when-downgrade",
        "Cache-Control": "public, max-age=300",
    };

    if (!["GET", "HEAD"].includes(req.method || "")) {
        res.writeHead(405, { ...baseHeaders, "Content-Type": "text/plain", "Allow": "GET, HEAD" });
        res.end("Method Not Allowed");
        return;
    }

    const safePath = sanitizePath(req.url || "/");

    // ── Manifest — /:section/manifest.json ───────────────────────────────────
    const manifestMatch = safePath.match(/^\/(projects|small-projects)\/manifest\.json$/);
    if (manifestMatch) {
        const manifest = getProjectManifest(manifestMatch[1]);
        const body     = JSON.stringify(manifest);
        res.writeHead(200, {
            ...baseHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── About-me media listing — /about-me/media-listing/:folder ─────────────
    const aboutMeListingMatch = safePath.match(/^\/about-me\/media-listing\/([^\/]+)\/?$/);
    if (aboutMeListingMatch) {
        const folder = aboutMeListingMatch[1];

        if (!/^[\w\-]+$/.test(folder)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end("[]");
            return;
        }

        const folderPath = path.join(PUBLIC_DIR, "media", "about-me", folder);
        const SUPPORTED  = /\.(png|mp4)$/i;
        let files = [];

        if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
            files = fs.readdirSync(folderPath)
                .filter(f =>
                    SUPPORTED.test(f) &&
                    fs.statSync(path.join(folderPath, f)).isFile()
                )
                .sort(naturalSort);
        }

        const body = JSON.stringify(files);
        res.writeHead(200, {
            ...baseHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── Project media listing — /:section/:slug/media-listing/:folder ─────────
    const mediaListingMatch = safePath.match(
        /^\/(projects|small-projects)\/([^\/]+)\/media-listing\/([^\/]+)\/?$/
    );
    if (mediaListingMatch) {
        const section = mediaListingMatch[1];
        const slug    = mediaListingMatch[2];
        const folder  = mediaListingMatch[3];

        if (!/^[\w\-]+$/.test(folder) || !/^[\w\-]+$/.test(slug)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end("[]");
            return;
        }

        const folderPath = path.join(PUBLIC_DIR, section, slug, "media", folder);
        const SUPPORTED  = /\.(png|mp4)$/i;
        let files = [];

        if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
            files = fs.readdirSync(folderPath)
                .filter(f =>
                    SUPPORTED.test(f) &&
                    fs.statSync(path.join(folderPath, f)).isFile()
                )
                .sort(naturalSort);
        }

        const body = JSON.stringify(files);
        res.writeHead(200, {
            ...baseHeaders,
            "Content-Type":   "application/json; charset=utf-8",
            "Content-Length": Buffer.byteLength(body),
            "Cache-Control":  "no-store",
        });
        res.end(body);
        return;
    }

    // ── Project slug page — /:section/:slug ───────────────────────────────────
    const slugMatch = safePath.match(/^\/(projects|small-projects)\/([^\/]+)\/?$/);
    if (slugMatch) {
        const section    = slugMatch[1];
        const slug       = slugMatch[2];
        const configPath = path.join(PUBLIC_DIR, section, slug, "config.json");

        if (fs.existsSync(configPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
                const html   = buildProjectEmbedHtml(slug, config, origin, section);
                res.writeHead(200, {
                    ...baseHeaders,
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

    // ── Static file serving ───────────────────────────────────────────────────
    let fsPath = path.join(PUBLIC_DIR, safePath);

    try {
        const stat = fs.statSync(fsPath);

        if (stat.isDirectory()) {
            const indexPath = path.join(fsPath, "index.html");
            if (fileExists(indexPath)) {
                fsPath = indexPath;
            } else {
                res.writeHead(404, { ...baseHeaders, "Content-Type": "text/plain" });
                res.end("404 Not Found");
                return;
            }
        }

        const finalStat = fs.statSync(fsPath);
        res.writeHead(200, {
            ...baseHeaders,
            "Content-Type":   getMimeType(fsPath),
            "Content-Length": finalStat.size,
        });

        if (req.method === "HEAD") {
            res.end();
        } else {
            fs.createReadStream(fsPath).pipe(res);
        }
    } catch {
        res.writeHead(404, { ...baseHeaders, "Content-Type": "text/plain" });
        res.end("404 Not Found");
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving: ${PUBLIC_DIR}`);
});
