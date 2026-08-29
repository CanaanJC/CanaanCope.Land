const fs = require("fs");
const path = require("path");
const { PUBLIC_DIR } = require("./constants");
const { escape, naturalSort, injectTwemoji } = require("./utils");
const { cachedStat, fileExists, dirExists } = require("./fsCache");
const { getSiteInfo } = require("./siteConfig");

// Resolve the best available thumbnail/preview media for a given media dir
// and produce the appropriate OG/Twitter meta tag block.
function buildImageTag(mediaDir, urlsFor) {
    if (!dirExists(mediaDir)) {
        return `\n    <meta name="twitter:card" content="summary" />`;
    }

    const thumbPng = path.join(mediaDir, "thumb.png");
    const thumbMp4 = path.join(mediaDir, "thumb.mp4");

    if (fileExists(thumbPng)) {
        const imgUrl = urlsFor("thumb.png");
        return `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
    }

    if (fileExists(thumbMp4)) {
        const vidUrl = urlsFor("thumb.mp4");
        return `
    <meta property="og:video" content="${escape(vidUrl)}" />
    <meta property="og:video:type" content="video/mp4" />
    <meta name="twitter:card" content="player" />
    <meta name="twitter:player" content="${escape(vidUrl)}" />`;
    }

    const images = fs.readdirSync(mediaDir)
        .filter(f => {
            if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(f)) return false;
            const s = cachedStat(path.join(mediaDir, f));
            return s && s.isFile();
        })
        .sort(naturalSort);

    if (images.length > 0) {
        const imgUrl = urlsFor(images[0]);
        return `
    <meta property="og:image" content="${escape(imgUrl)}" />
    <meta name="twitter:image" content="${escape(imgUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />`;
    }

    return `\n    <meta name="twitter:card" content="summary" />`;
}

function buildHeadMeta({ title, description, url, imageTag }) {
    const { siteName } = getSiteInfo();
    const siteNameTag = siteName
        ? `\n    <meta property="og:site_name" content="${escape(siteName)}" />`
        : "";

    return `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:type" content="article" />${siteNameTag}
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${imageTag}`;
}

// Generic embed builder — works for a library of any depth. `slugParts` is
// the array of folder segments leading to the entry (length === library.depth).
//
// title/description come strictly from config.json — if either is missing
// or empty, that tag is simply blank. Neither ever falls back to the slug,
// the library name, or any other field.
//
// The Twemoji <script> tag is injected server-side (see injectTwemoji)
// into both the redirect page and the "blocked" full-render page below —
// no .html file on disk ever needs to carry it itself.
function buildLibraryEmbedHtml(library, slugParts, config, origin) {
    const title        = escape(config.name        || "");
    const description  = escape(config.description || "");
    const encodedParts = slugParts.map(encodeURIComponent);
    const url          = `${origin}/${library.path}/${encodedParts.join("/")}`;
    const anchorId     = slugParts.join("--");
    // Libraries are physically stored under public/libraries/<path> — see
    // lib/staticFile.js's resolveFsPath for the matching transparent rewrite.
    // The URL below (urlsFor) intentionally still uses the bare library.path,
    // since that's what's actually reachable over HTTP.
    const mediaDir     = path.join(PUBLIC_DIR, "libraries", library.path, ...slugParts, "media");

    const imageTag = buildImageTag(
        mediaDir,
        (file) => `${origin}/${library.path}/${encodedParts.join("/")}/media/${encodeURIComponent(file)}`
    );

    const head = buildHeadMeta({ title, description, url, imageTag });

    if (config.block) {
        const html = `<!DOCTYPE html>
<html lang="en">
  <head>
${head}
    <link rel="stylesheet" href="/css/main.css" />
    <link rel="stylesheet" href="/css/lib-blog.css" />
    <link rel="stylesheet" href="/css/library.css" />
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
      window.__LIBRARY_BLOCKED_PATH__ = ${JSON.stringify(library.path)};
      window.__LIBRARY_BLOCKED_SLUG__ = ${JSON.stringify(slugParts)};
    </script>
    <script src="/js/main.js" type="module"></script>
    <script src="/js/library.js" type="module"></script>
  </body>
</html>`;
        return injectTwemoji(html);
    }

    const html = `<!DOCTYPE html>
<html lang="en">
  <head>
${head}
    <script>
      window.location.replace("/${library.path}#${anchorId}");
    </script>
  </head>
  <body></body>
</html>`;
    return injectTwemoji(html);
}

module.exports = { buildLibraryEmbedHtml };
