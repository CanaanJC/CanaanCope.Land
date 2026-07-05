// ─────────────────────────────────────────────────────────────────────────────
// lib-blog.js — Shared rendering library for blog-style content
//
// Provides parsing, rendering, gallery, and lazy-loading utilities for
// project entries (about-me, featured projects, project listings).
//
// Mobile vs desktop rendering:
//   - parseContentMd extracts [P…] blocks AND strips any nested [M…]…[/M…]
//     sub-blocks from their content — [M…] is mobile-only and is invisible
//     to the desktop renderer.
//   - parseAllBlocks (mobile path) extracts both [P…] and [M…] in document
//     order. The mobile renderer (registered via setMobileRowsBuilder)
//     handles nested [M…] inside P content itself by splitting the text.
//   - buildRows wraps its output in a .blog-rows-wrapper (display:contents)
//     that stores its render inputs, enabling rerenderAllBlogContent() to
//     rebuild every rendered block in place when the viewport toggles
//     between mobile and desktop.
// ─────────────────────────────────────────────────────────────────────────────

console.log("lib-blog module loaded");

const MARKED_CDN = "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js";
const BLOG_ROWS_WRAPPER_CLASS = "blog-rows-wrapper";

// ── Markdown loader ──────────────────────────────────────────────────────────

export async function loadMarked() {
    if (window.marked) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = MARKED_CDN;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ── Date helpers ─────────────────────────────────────────────────────────────

export function getEndDate(date) {
    if (!date) return null;
    if (Array.isArray(date)) return date.length >= 2 ? date[1] : date[0];
    return date;
}

export function parseDateStr(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

export function sortByEndDate(list) {
    return [...list].sort((a, b) => {
        const da = parseDateStr(getEndDate(a.date));
        const db = parseDateStr(getEndDate(b.date));
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
    });
}

// ── Content parsing ──────────────────────────────────────────────────────────

// Desktop parser. Strips nested [M…]…[/M…] blocks from P content so they
// never appear on desktop.
export function parseContentMd(raw) {
    const blockRegex   = /\[P([^\]]+)\]([\s\S]*?)\[\/P\1\]/g;
    const innerMRegex  = /\[M([^\]]+)\]([\s\S]*?)\[\/M\1\]/g;
    const blocks = [];
    let match;
    while ((match = blockRegex.exec(raw)) !== null) {
        const cleanContent = match[2].replace(innerMRegex, "");
        blocks.push({ tag: match[1].trim(), content: cleanContent.trim() });
    }
    return blocks;
}

// Mobile-aware parser. Extracts both [P…] and [M…] blocks in document order.
// Returns { kind: "P"|"M", tag, content }. Nested [M…] inside P content stays
// embedded — the mobile renderer splits it out itself.
export function parseAllBlocks(raw) {
    const blockRegex = /\[([PM])([^\]]+)\]([\s\S]*?)\[\/\1\2\]/g;
    const blocks = [];
    let match;
    while ((match = blockRegex.exec(raw)) !== null) {
        blocks.push({
            kind:    match[1],
            tag:     match[2].trim(),
            content: match[3].trim(),
        });
    }
    return blocks;
}

export function isImageBlock(content) {
    return /^[\w\-]+\.(png|jpg|jpeg|gif|webp|svg)$/i.test(content.trim());
}

export function isVideoBlock(content) {
    return /^[\w\-]+\.(mp4|webm)$/i.test(content.trim());
}

export function isAudioBlock(content) {
    return /^[\w\-]+\.(mp3|wav)$/i.test(content.trim());
}

export function isFolderBlock(content) {
    return /^\.\/[\w\-]+$/.test(content.trim());
}

export function groupIntoRows(blocks) {
    const rowMap = new Map();
    for (const block of blocks) {
        const m = block.tag.match(/^(\d+)([ab]?)$/);
        if (!m) continue;
        const num  = m[1];
        const side = m[2] || "full";
        if (!rowMap.has(num)) rowMap.set(num, {});
        rowMap.get(num)[side] = block.content;
    }
    return [...rowMap.entries()]
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([num, sides]) => ({ num, sides }));
}

// ── Inline media detection ───────────────────────────────────────────────────

function isInlineMediaReference(text) {
    return /<[\w\-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav)>/i.test(text) ||
           /<\.\/[\w\-]+>/i.test(text);
}

function extractInlineMedia(text) {
    const regex = /<(\.\/[\w\-]+|[\w\-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav))>/gi;
    const segments = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: "text", content: text.substring(lastIndex, match.index) });
        }
        const value = match[1];
        const isFolder = value.startsWith("./");
        segments.push({ type: isFolder ? "folder" : "media", content: value });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        segments.push({ type: "text", content: text.substring(lastIndex) });
    }

    return segments;
}

function isImageFile(filename) {
    return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(filename);
}

function isVideoFile(filename) {
    return /\.(mp4|webm)$/i.test(filename);
}

function isAudioFile(filename) {
    return /\.(mp3|wav)$/i.test(filename);
}

// ── Multi-media block parsing ────────────────────────────────────────────────

function parseMediaLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (/^<\.\/[\w\-]+>$/.test(trimmed)) {
        return { kind: "folder", value: trimmed.slice(1, -1) };
    }
    const inlineFile = trimmed.match(/^<([\w\-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav))>$/i);
    if (inlineFile) {
        return { kind: "file", value: inlineFile[1] };
    }
    if (/^\.\/[\w\-]+$/.test(trimmed)) {
        return { kind: "folder", value: trimmed };
    }
    if (/^[\w\-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav)$/i.test(trimmed)) {
        return { kind: "file", value: trimmed };
    }

    return null;
}

export function parseMultiMediaBlock(content) {
    const lines  = content.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const parsed = lines.map(parseMediaLine);
    if (parsed.some(p => p === null)) return null;
    return parsed;
}

// ── Gallery modal ────────────────────────────────────────────────────────────

let _escListener = null;

export function closeGalleryModal() {
    const overlay = document.getElementById("blog-gallery-modal-overlay");
    if (overlay) overlay.remove();
    document.body.classList.remove("blog-gallery-open");
    if (_escListener) {
        document.removeEventListener("keydown", _escListener);
        _escListener = null;
    }
}

export function openGalleryModal(files, mediaBaseUrl) {
    closeGalleryModal();

    const colCount = Math.min(files.length, 3);

    const overlay = document.createElement("div");
    overlay.id = "blog-gallery-modal-overlay";
    overlay.className = "blog-gallery-overlay";
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeGalleryModal();
    });

    const card = document.createElement("div");
    card.className = "blog-gallery-card";

    const closeBtn = document.createElement("button");
    closeBtn.className = "blog-gallery-close";
    closeBtn.setAttribute("aria-label", "Close gallery");
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <line x1="2" y1="2" x2="16" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="2" x2="2" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    closeBtn.addEventListener("click", closeGalleryModal);

    const columns = document.createElement("div");
    columns.className = "blog-gallery-columns";

    const cols = Array.from({ length: colCount }, () => {
        const col = document.createElement("div");
        col.className = "blog-gallery-col";
        return col;
    });

    files.forEach((file, i) => {
        const item = document.createElement("div");
        item.className = "blog-gallery-item";

        if (isVideoFile(file)) {
            const video = document.createElement("video");
            video.className = "blog-gallery-media";
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;
            const source = document.createElement("source");
            source.src  = `${mediaBaseUrl}/${file}`;
            source.type = /\.webm$/i.test(file) ? "video/webm" : "video/mp4";
            video.appendChild(source);
            item.appendChild(video);
        } else if (isAudioFile(file)) {
            const wrap = document.createElement("div");
            wrap.className = "blog-audio-wrap";
            const audio = document.createElement("audio");
            audio.className = "blog-audio";
            audio.controls = true;
            audio.preload = "metadata";
            const source = document.createElement("source");
            source.src  = `${mediaBaseUrl}/${file}`;
            source.type = /\.wav$/i.test(file) ? "audio/wav" : "audio/mpeg";
            audio.appendChild(source);
            wrap.appendChild(audio);
            item.appendChild(wrap);
        } else {
            const img = document.createElement("img");
            img.className = "blog-gallery-media";
            img.src = `${mediaBaseUrl}/${file}`;
            img.alt = file;
            img.loading = "lazy";
            item.appendChild(img);
        }

        cols[i % colCount].appendChild(item);
    });

    cols.forEach(col => columns.appendChild(col));
    card.appendChild(closeBtn);
    card.appendChild(columns);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.classList.add("blog-gallery-open");

    _escListener = (e) => { if (e.key === "Escape") closeGalleryModal(); };
    document.addEventListener("keydown", _escListener);
}

// ── Folder cell ──────────────────────────────────────────────────────────────

export function renderFolderCell(folderName, mediaBaseUrl, listingUrl) {
    const cell = document.createElement("div");
    cell.className = "blog-cell blog-cell--image-left";

    const outer = document.createElement("div");
    outer.className = "blog-folder-outer";

    const wrap = document.createElement("span");
    wrap.className = "blog-image-wrap";
    outer.appendChild(wrap);
    cell.appendChild(outer);

    fetch(`${listingUrl}?_=${Date.now()}`, { cache: "no-store" })
        .then(r => r.json())
        .then(files => {
            if (!files.length) return;

            const first           = files[0];
            const remaining       = files.length - 1;
            const folderMediaBase = `${mediaBaseUrl}/${folderName}`;

            if (isVideoFile(first)) {
                const video = document.createElement("video");
                video.className = "blog-video";
                video.controls = true;
                video.preload = "auto";
                video.playsInline = true;
                const source = document.createElement("source");
                source.src  = `${folderMediaBase}/${first}`;
                source.type = /\.webm$/i.test(first) ? "video/webm" : "video/mp4";
                video.appendChild(source);
                wrap.appendChild(video);
            } else if (isAudioFile(first)) {
                const audioWrap = document.createElement("div");
                audioWrap.className = "blog-audio-wrap";
                const audio = document.createElement("audio");
                audio.className = "blog-audio";
                audio.controls = true;
                audio.preload = "metadata";
                const source = document.createElement("source");
                source.src  = `${folderMediaBase}/${first}`;
                source.type = /\.wav$/i.test(first) ? "audio/wav" : "audio/mpeg";
                audio.appendChild(source);
                audioWrap.appendChild(audio);
                wrap.appendChild(audioWrap);
            } else {
                const img = document.createElement("img");
                img.className = "blog-image";
                img.src = `${folderMediaBase}/${first}`;
                img.alt = first;
                img.loading = "lazy";
                wrap.appendChild(img);
            }

            outer.style.cursor = "pointer";
            outer.addEventListener("click", () => openGalleryModal(files, folderMediaBase));

            if (remaining > 0) {
                const badge = document.createElement("span");
                badge.className = "blog-folder-badge";
                badge.textContent = `+${remaining}`;
                outer.appendChild(badge);
            }
        })
        .catch(err => console.error(`Failed to load media folder "${folderName}":`, err));

    return cell;
}

// ── Inline media renderer ────────────────────────────────────────────────────

function renderInlineMedia(filename, mediaBaseUrl, listingBaseUrl) {
    if (filename.startsWith("./")) {
        const folderName = filename.slice(2);
        return renderFolderCell(folderName, mediaBaseUrl, `${listingBaseUrl}/${folderName}`);
    }

    if (isImageFile(filename)) {
        const wrap = document.createElement("span");
        wrap.className = "blog-image-wrap";
        const img = document.createElement("img");
        img.className = "blog-image";
        img.src = `${mediaBaseUrl}/${filename}`;
        img.alt = filename;
        img.loading = "lazy";
        img.addEventListener("error", () => {
            const textNode = document.createTextNode(`<${filename}>`);
            wrap.replaceWith(textNode);
        });
        wrap.appendChild(img);
        return wrap;

    } else if (isVideoFile(filename)) {
        const wrap = document.createElement("span");
        wrap.className = "blog-image-wrap blog-video-wrap";
        const video = document.createElement("video");
        video.className = "blog-video";
        video.controls = true;
        video.preload = "auto";
        video.playsInline = true;
        const source = document.createElement("source");
        source.src  = `${mediaBaseUrl}/${filename}`;
        source.type = /\.webm$/i.test(filename) ? "video/webm" : "video/mp4";
        video.addEventListener("error", () => {
            const textNode = document.createTextNode(`<${filename}>`);
            wrap.replaceWith(textNode);
        });
        video.appendChild(source);
        wrap.appendChild(video);
        return wrap;

    } else if (isAudioFile(filename)) {
        const wrap = document.createElement("div");
        wrap.className = "blog-audio-wrap";
        const audio = document.createElement("audio");
        audio.className = "blog-audio";
        audio.controls = true;
        audio.preload = "metadata";
        const source = document.createElement("source");
        source.src  = `${mediaBaseUrl}/${filename}`;
        source.type = /\.wav$/i.test(filename) ? "audio/wav" : "audio/mpeg";
        audio.addEventListener("error", () => {
            const textNode = document.createTextNode(`<${filename}>`);
            wrap.replaceWith(textNode);
        });
        audio.appendChild(source);
        wrap.appendChild(audio);
        return wrap;
    }

    return document.createTextNode(`<${filename}>`);
}

// ── Cell renderer ────────────────────────────────────────────────────────────

export function renderCell(content, mediaBaseUrl, listingBaseUrl, isImage, isVideo, isAudio, isFolder) {
    if (isFolder) {
        const folderName = content.trim().slice(2);
        return renderFolderCell(folderName, mediaBaseUrl, `${listingBaseUrl}/${folderName}`);
    }

    const cell = document.createElement("div");
    cell.className = "blog-cell";

    const multiMedia = parseMultiMediaBlock(content);
    if (multiMedia) {
        cell.classList.add("blog-cell--image-left", "blog-media-stack");
        for (const entry of multiMedia) {
            const item = document.createElement("div");
            item.className = "blog-media-stack-item";
            item.appendChild(renderInlineMedia(entry.value, mediaBaseUrl, listingBaseUrl));
            cell.appendChild(item);
        }
        return cell;
    }

    if (!isImage && !isVideo && !isAudio && isInlineMediaReference(content)) {
        const segments  = extractInlineMedia(content);
        const container = document.createElement("div");
        container.className = "blog-md-content";

        for (const segment of segments) {
            if (segment.type === "text") {
                const textDiv = document.createElement("div");
                textDiv.innerHTML = window.marked.parse(segment.content);
                while (textDiv.firstChild) container.appendChild(textDiv.firstChild);
            } else if (segment.type === "media" || segment.type === "folder") {
                container.appendChild(renderInlineMedia(segment.content, mediaBaseUrl, listingBaseUrl));
            }
        }

        cell.appendChild(container);
        return cell;
    }

    if (isImage) {
        const wrap = document.createElement("span");
        wrap.className = "blog-image-wrap";
        const img = document.createElement("img");
        img.className = "blog-image";
        img.src = `${mediaBaseUrl}/${content.trim()}`;
        img.alt = content.trim();
        img.loading = "lazy";
        wrap.appendChild(img);
        cell.appendChild(wrap);

    } else if (isVideo) {
        const wrap = document.createElement("span");
        wrap.className = "blog-image-wrap blog-video-wrap";
        const video = document.createElement("video");
        video.className = "blog-video";
        video.controls = true;
        video.preload = "auto";
        video.playsInline = true;
        const source = document.createElement("source");
        source.src  = `${mediaBaseUrl}/${content.trim()}`;
        source.type = /\.webm$/i.test(content) ? "video/webm" : "video/mp4";
        video.appendChild(source);
        wrap.appendChild(video);
        cell.appendChild(wrap);

    } else if (isAudio) {
        const wrap = document.createElement("div");
        wrap.className = "blog-audio-wrap";
        const audio = document.createElement("audio");
        audio.className = "blog-audio";
        audio.controls = true;
        audio.preload = "metadata";
        const source = document.createElement("source");
        source.src  = `${mediaBaseUrl}/${content.trim()}`;
        source.type = /\.wav$/i.test(content) ? "audio/wav" : "audio/mpeg";
        audio.appendChild(source);
        wrap.appendChild(audio);
        cell.appendChild(wrap);

    } else {
        const div = document.createElement("div");
        div.className = "blog-md-content";
        div.innerHTML = window.marked.parse(content);
        cell.appendChild(div);
    }

    return cell;
}

// ── Mobile row builder hook ──────────────────────────────────────────────────

let _mobileRowsBuilder = null;

export function setMobileRowsBuilder(fn) {
    _mobileRowsBuilder = fn;
}

// ── Internal: build the row fragment for the current mode ────────────────────

function _renderRowsFragment(rawMd, mediaBaseUrl, listingBaseUrl) {
    if (document.body.classList.contains("mobile") && _mobileRowsBuilder) {
        return _mobileRowsBuilder(rawMd, mediaBaseUrl, listingBaseUrl);
    }
    return _buildDesktopRowsFragment(rawMd, mediaBaseUrl, listingBaseUrl);
}

function _buildDesktopRowsFragment(rawMd, mediaBaseUrl, listingBaseUrl) {
    const frag = document.createDocumentFragment();
    const rows = groupIntoRows(parseContentMd(rawMd));

    for (const row of rows) {
        const { sides } = row;
        const rowEl = document.createElement("div");
        rowEl.className = "blog-row";

        if (sides.full !== undefined) {
            rowEl.classList.add("blog-row--full");
            const isImg = isImageBlock(sides.full);
            const isVid = isVideoBlock(sides.full);
            const isAud = isAudioBlock(sides.full);
            const isDir = isFolderBlock(sides.full);
            const cell  = renderCell(sides.full, mediaBaseUrl, listingBaseUrl, isImg, isVid, isAud, isDir);
            if (isImg || isVid || isDir) cell.classList.add("blog-cell--image-left");
            rowEl.appendChild(cell);

        } else {
            rowEl.classList.add("blog-row--half");

            const hasA     = sides.a !== undefined;
            const hasB     = sides.b !== undefined;
            const aIsImg   = hasA && isImageBlock(sides.a);
            const aIsVid   = hasA && isVideoBlock(sides.a);
            const aIsAud   = hasA && isAudioBlock(sides.a);
            const aIsDir   = hasA && isFolderBlock(sides.a);
            const bIsImg   = hasB && isImageBlock(sides.b);
            const bIsVid   = hasB && isVideoBlock(sides.b);
            const bIsAud   = hasB && isAudioBlock(sides.b);
            const bIsDir   = hasB && isFolderBlock(sides.b);
            const aIsMedia = aIsImg || aIsVid || aIsAud || aIsDir;
            const bIsMedia = bIsImg || bIsVid || bIsAud || bIsDir;

            if (hasA) {
                const cellA = renderCell(sides.a, mediaBaseUrl, listingBaseUrl, aIsImg, aIsVid, aIsAud, aIsDir);
                if (aIsMedia)              cellA.classList.add("blog-cell--image-left");
                else if (hasB && bIsMedia) cellA.classList.add("blog-cell--text-beside-image");
                rowEl.appendChild(cellA);
            } else {
                const empty = document.createElement("div");
                empty.className = "blog-cell blog-cell--empty";
                rowEl.appendChild(empty);
            }

            if (hasB) {
                const cellB = renderCell(sides.b, mediaBaseUrl, listingBaseUrl, bIsImg, bIsVid, bIsAud, bIsDir);
                if (bIsMedia)              cellB.classList.add("blog-cell--image-right");
                else if (hasA && aIsMedia) cellB.classList.add("blog-cell--text-beside-image");
                rowEl.appendChild(cellB);
            } else {
                const empty = document.createElement("div");
                empty.className = "blog-cell blog-cell--empty";
                rowEl.appendChild(empty);
            }
        }

        frag.appendChild(rowEl);
    }

    return frag;
}

// ── Rows builder (public) ────────────────────────────────────────────────────

export function buildRows(rawMd, mediaBaseUrl, listingBaseUrl) {
    // Wrap the fragment in a tracker element so rerenderAllBlogContent()
    // can find and rebuild it later when the viewport mode toggles.
    // display:contents makes the wrapper invisible to layout — its children
    // appear as if direct siblings under the parent, preserving all CSS.
    const wrapper = document.createElement("div");
    wrapper.className = BLOG_ROWS_WRAPPER_CLASS;
    wrapper.style.display = "contents";
    wrapper.__blogRenderArgs = { rawMd, mediaBaseUrl, listingBaseUrl };
    wrapper.appendChild(_renderRowsFragment(rawMd, mediaBaseUrl, listingBaseUrl));
    return wrapper;
}

// ── Re-render all tracked blog content (called on mode toggle) ───────────────

export function rerenderAllBlogContent() {
    const wrappers = document.querySelectorAll(`.${BLOG_ROWS_WRAPPER_CLASS}`);
    for (const wrapper of wrappers) {
        const args = wrapper.__blogRenderArgs;
        if (!args) continue;
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        wrapper.appendChild(_renderRowsFragment(args.rawMd, args.mediaBaseUrl, args.listingBaseUrl));
    }
}

// ── Project block builder ────────────────────────────────────────────────────

export function buildProjectBlock(options) {
    const {
        elementId,
        title,
        date,
        rawMd,
        mediaBaseUrl,
        listingBaseUrl,
    } = options;

    const article = document.createElement("article");
    article.className = "blog-block";
    if (elementId) article.id = elementId;

    const header = document.createElement("div");
    header.className = "blog-header";

    const titleEl = document.createElement("h2");
    titleEl.className = "blog-title";
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (date) {
        const dateEl = document.createElement("div");
        dateEl.className = "blog-date";
        if (Array.isArray(date) && date.length === 2) {
            dateEl.textContent = `${date[0]} – ${date[1]}`;
        } else {
            dateEl.textContent = Array.isArray(date) ? date[0] : date;
        }
        header.appendChild(dateEl);
    }

    article.appendChild(header);
    article.appendChild(buildRows(rawMd, mediaBaseUrl, listingBaseUrl));

    return article;
}

// ── Placeholder for lazy loading ─────────────────────────────────────────────

export function createPlaceholder(elementId, minHeight = 400) {
    const div = document.createElement("div");
    div.className = "blog-placeholder";
    div.id = `placeholder-${elementId}`;
    div.dataset.slug = elementId;
    div.style.minHeight = `${minHeight}px`;
    return div;
}

// ── Lazy loader ──────────────────────────────────────────────────────────────

export function setupLazyLoading(slugs, loadFn, preloadAhead = 2) {
    const preloadMargin = `${preloadAhead * 100}%`;
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const placeholder = entry.target;
                const slug = placeholder.dataset.slug;
                if (!slug) continue;
                observer.unobserve(placeholder);
                Promise.resolve(loadFn(slug)).then(dom => {
                    if (dom && placeholder.parentNode) placeholder.replaceWith(dom);
                });
            }
        },
        { rootMargin: `0px 0px ${preloadMargin} 0px`, threshold: 0 }
    );
    for (const slug of slugs) {
        const placeholder = document.getElementById(`placeholder-${slug}`);
        if (placeholder) observer.observe(placeholder);
    }
    return observer;
}
