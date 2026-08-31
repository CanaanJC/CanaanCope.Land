
console.log("lib-blog module loaded");

const MARKED_CDN = "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js";
const BLOG_ROWS_WRAPPER_CLASS = "blog-rows-wrapper";

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

export function getEndDate(date) {
    if (!date) return null;
    if (Array.isArray(date)) return date.length > 0 ? date[date.length - 1] : null;
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

export function formatDateRanges(dateArr) {
    if (!Array.isArray(dateArr)) return String(dateArr);
    const parts = [];
    let i = 0;
    while (i < dateArr.length) {
        if (i + 1 < dateArr.length) {
            parts.push(`${dateArr[i]} – ${dateArr[i + 1]}`);
            i += 2;
        } else {
            parts.push(dateArr[i]);
            i += 1;
        }
    }
    return parts.join(", ");
}

function isGifFile(filename) {
    return /\.gif$/i.test(filename);
}

function isImageFile(filename) {
    return /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(filename);
}

function isVideoFile(filename) {
    return /\.(mp4|webm)$/i.test(filename);
}

function isAudioFile(filename) {
    return /\.(mp3|wav)$/i.test(filename);
}

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

function inlineTokenRegex() {
    return /<([^<>]+)>/g;
}

export function parseInlineToken(raw) {
    const value = String(raw).trim();
    if (!value) return null;

    if (/^\.\/[\w\-]+$/.test(value)) {
        return { type: "folder", folder: value.slice(2) };
    }

    if (/^link:/i.test(value)) {
        let rest = value.slice(5).trim();
        let interactive = false;
        if (/\|click$/i.test(rest)) {
            interactive = true;
            rest = rest.replace(/\|click$/i, "").trim();
        }
        const url = rest;
        if (!url) return null;
        return { type: "link", url, interactive };
    }

    if (/^stl:/i.test(value)) {
        const rest  = value.slice(4).trim();
        const parts = rest.split("|").map(p => p.trim());
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
        return { type: "stl", file: parts[0], bgColor: parts[1], modelColor: parts[2] };
    }

    const loopMatch = value.match(/^([\w\-./]+\.[a-z0-9]+)\s+loop$/i);
    const filename  = loopMatch ? loopMatch[1] : value;
    const loop      = !!loopMatch;

    if (isImageFile(filename)) return { type: "image", file: filename };
    if (isVideoFile(filename)) return { type: "video", file: filename, loop };
    if (isAudioFile(filename)) return { type: "audio", file: filename };

    return null;
}

export function extractInlineSegments(text) {
    const regex = inlineTokenRegex();
    const segments = [];
    let lastIndex = 0;
    let m;

    while ((m = regex.exec(text)) !== null) {
        const token = parseInlineToken(m[1]);
        if (!token) continue; // leave unrecognized bracket text embedded in the surrounding text

        if (m.index > lastIndex) {
            segments.push({ type: "text", value: text.substring(lastIndex, m.index) });
        }
        segments.push({ type: "token", token });
        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        segments.push({ type: "text", value: text.substring(lastIndex) });
    }

    return segments;
}

export function isSoleToken(content) {
    const trimmed = String(content).trim();
    const m = trimmed.match(/^<([^<>]+)>$/);
    if (!m) return null;
    return parseInlineToken(m[1]);
}

export function parseMultiMediaBlock(content) {
    const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    const tokens = lines.map(isSoleToken);
    if (tokens.some(t => !t)) return null;
    return tokens;
}

export function isMediaOnlyBlock(content) {
    return !!isSoleToken(content) || !!parseMultiMediaBlock(content);
}

function buildLoopVideoEl(src, file, isGif, className) {
    const video = document.createElement("video");
    video.className = className || "blog-video blog-loop-video";
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.controls = false;
    video.setAttribute("muted", "");
    video.setAttribute("autoplay", "");
    video.setAttribute("loop", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("disablepictureinpicture", "");

    const source = document.createElement("source");
    source.src  = src;
    source.type = /\.webm$/i.test(file) ? "video/webm" : "video/mp4";
    video.appendChild(source);

    let fallbackTimer = null;

    const kickPlay = () => { video.play().catch(() => {}); };

    video.addEventListener("loadeddata", () => {
        if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
        kickPlay();
    });
    video.addEventListener("canplay", kickPlay);

    if (isGif) {
        let swapped = false;
        const swapToImg = () => {
            if (swapped) return;
            swapped = true;
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            const img = document.createElement("img");
            img.className = "blog-image";
            img.src = src;   // same .gif URL — plays natively as an animated image
            img.alt = file;
            img.loading = "lazy";
            if (video.parentNode) video.replaceWith(img);
        };

        video.addEventListener("error", swapToImg, { once: true });
        source.addEventListener("error", swapToImg, { once: true });

        fallbackTimer = setTimeout(() => {
            if (!swapped && video.videoWidth === 0) swapToImg();
        }, 1200);
    }

    return video;
}

function makeLoopWrap(src, file, isGif) {
    const wrap = document.createElement("span");
    wrap.className = "blog-image-wrap blog-video-wrap blog-loop-wrap";
    wrap.appendChild(buildLoopVideoEl(src, file, isGif, "blog-video blog-loop-video"));
    return wrap;
}

function buildLinkErrorCard(url) {
    const card = document.createElement("div");
    card.className = "blog-link-error";

    const text = document.createElement("div");
    text.className = "blog-link-error__text";
    text.textContent = "This page couldn't be loaded";
    card.appendChild(text);

    const link = document.createElement("a");
    link.className = "blog-link-error__link";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url;
    card.appendChild(link);

    return card;
}

function buildOpenInNewTabButton(url) {
    const btn = document.createElement("a");
    btn.className = "blog-link-open-btn";
    btn.href = url;
    btn.target = "_blank";
    btn.rel = "noopener noreferrer";
    btn.title = "Open in new tab";
    btn.setAttribute("aria-label", "Open in new tab");
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path d="M14 5h5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 5L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return btn;
}

function renderLinkEmbed(url, interactive) {
    const wrap = document.createElement("span");
    wrap.className = "blog-link-wrap" + (interactive ? " blog-link-wrap--interactive" : " blog-link-wrap--static");

    const iframe = document.createElement("iframe");
    iframe.className = "blog-link-iframe";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    if (!interactive) {
        iframe.tabIndex = -1;
        iframe.setAttribute("aria-hidden", "true");
    }
    wrap.appendChild(iframe);

    if (interactive) {
        wrap.appendChild(buildOpenInNewTabButton(url));
    } else {
        const overlay = document.createElement("a");
        overlay.className = "blog-link-static-anchor";
        overlay.href = url;
        overlay.target = "_blank";
        overlay.rel = "noopener noreferrer";
        overlay.setAttribute("aria-label", `Open ${url} in new tab`);
        wrap.appendChild(overlay);
    }

    fetch(url, { mode: "no-cors" })
        .then(() => { iframe.src = url; })
        .catch(() => {
            wrap.innerHTML = "";
            wrap.appendChild(buildLinkErrorCard(url));
        });

    return wrap;
}

let _threePromise = null;

const STL_FILL_FRACTION = 0.9; // ← model's diameter fills this fraction of the viewport

function loadThreeStack() {
    if (_threePromise) return _threePromise;
    _threePromise = Promise.all([
        import("https://cdn.jsdelivr.net/npm/three@0.160.0/+esm"),
        import("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js/+esm"),
        import("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js/+esm"),
    ]).then(([THREE, STLLoaderMod, OrbitControlsMod]) => ({
        THREE,
        STLLoader: STLLoaderMod.STLLoader,
        OrbitControls: OrbitControlsMod.OrbitControls,
    }));
    return _threePromise;
}

function renderStlViewer(url, bgColor, modelColor) {
    const wrap = document.createElement("div");
    wrap.className = "blog-stl-wrap";

    loadThreeStack().then(({ THREE, STLLoader, OrbitControls }) => {
        const width  = wrap.clientWidth  || 300;
        const height = wrap.clientHeight || 300;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(bgColor);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        wrap.appendChild(renderer.domElement);

        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(1, 1, 1);
        scene.add(dirLight);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enableZoom = false;
        controls.enablePan = false;

        const loader = new STLLoader();
        loader.load(
            url,
            (geometry) => {
                geometry.rotateX(-Math.PI / 2);

                geometry.computeVertexNormals();
                geometry.computeBoundingSphere();

                const material = new THREE.MeshStandardMaterial({ color: modelColor });
                const mesh = new THREE.Mesh(geometry, material);

                const sphere = geometry.boundingSphere;
                if (sphere) {
                    mesh.position.set(-sphere.center.x, -sphere.center.y, -sphere.center.z);
                }
                scene.add(mesh);

                const radius = (sphere && sphere.radius) || 1;
                const halfFovRad = THREE.MathUtils.degToRad(camera.fov / 2);
                const dist = radius / (STL_FILL_FRACTION * Math.tan(halfFovRad));
                const axis = dist / Math.sqrt(3);

                camera.position.set(axis, axis, axis);
                camera.lookAt(0, 0, 0);
                controls.update();
            },
            undefined,
            (err) => {
                console.error("STL: failed to load model:", err);
            }
        );

        const resizeObserver = new ResizeObserver(() => {
            const w = wrap.clientWidth  || 300;
            const h = wrap.clientHeight || 300;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        });
        resizeObserver.observe(wrap);

        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();
    }).catch((err) => {
        console.error("STL: failed to load three.js:", err);
    });

    return wrap;
}

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

        if (isGifFile(file)) {
            item.appendChild(buildLoopVideoEl(`${mediaBaseUrl}/${file}`, file, true, "blog-gallery-media blog-loop-video"));
        } else if (isVideoFile(file)) {
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

            if (isGifFile(first)) {
                wrap.appendChild(buildLoopVideoEl(`${folderMediaBase}/${first}`, first, true, "blog-video blog-loop-video"));
            } else if (isVideoFile(first)) {
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

export function renderMediaToken(token, mediaBaseUrl, listingBaseUrl) {
    switch (token.type) {
        case "folder":
            return renderFolderCell(token.folder, mediaBaseUrl, `${listingBaseUrl}/${token.folder}`);

        case "link":
            return renderLinkEmbed(token.url, !!token.interactive);

        case "stl":
            return renderStlViewer(`${mediaBaseUrl}/${token.file}`, token.bgColor, token.modelColor);

        case "image": {
            if (isGifFile(token.file)) {
                return makeLoopWrap(`${mediaBaseUrl}/${token.file}`, token.file, true);
            }
            const wrap = document.createElement("span");
            wrap.className = "blog-image-wrap";
            const img = document.createElement("img");
            img.className = "blog-image";
            img.src = `${mediaBaseUrl}/${token.file}`;
            img.alt = token.file;
            img.loading = "lazy";
            wrap.appendChild(img);
            return wrap;
        }

        case "video": {
            if (token.loop) {
                return makeLoopWrap(`${mediaBaseUrl}/${token.file}`, token.file, false);
            }
            const wrap = document.createElement("span");
            wrap.className = "blog-image-wrap blog-video-wrap";
            const video = document.createElement("video");
            video.className = "blog-video";
            video.controls = true;
            video.preload = "auto";
            video.playsInline = true;
            const source = document.createElement("source");
            source.src  = `${mediaBaseUrl}/${token.file}`;
            source.type = /\.webm$/i.test(token.file) ? "video/webm" : "video/mp4";
            video.appendChild(source);
            wrap.appendChild(video);
            return wrap;
        }

        case "audio": {
            const wrap = document.createElement("div");
            wrap.className = "blog-audio-wrap";
            const audio = document.createElement("audio");
            audio.className = "blog-audio";
            audio.controls = true;
            audio.preload = "metadata";
            const source = document.createElement("source");
            source.src  = `${mediaBaseUrl}/${token.file}`;
            source.type = /\.wav$/i.test(token.file) ? "audio/wav" : "audio/mpeg";
            audio.appendChild(source);
            wrap.appendChild(audio);
            return wrap;
        }

        default:
            return document.createTextNode("");
    }
}

export function renderCell(content, mediaBaseUrl, listingBaseUrl) {
    const cell = document.createElement("div");
    cell.className = "blog-cell";

    const stack = parseMultiMediaBlock(content);
    if (stack) {
        cell.classList.add("blog-cell--image-left", "blog-media-stack");
        for (const token of stack) {
            const item = document.createElement("div");
            item.className = "blog-media-stack-item";
            item.appendChild(renderMediaToken(token, mediaBaseUrl, listingBaseUrl));
            cell.appendChild(item);
        }
        return cell;
    }

    const sole = isSoleToken(content);
    if (sole) {
        if (sole.type === "folder") {
            return renderFolderCell(sole.folder, mediaBaseUrl, `${listingBaseUrl}/${sole.folder}`);
        }
        cell.classList.add("blog-cell--image-left");
        cell.appendChild(renderMediaToken(sole, mediaBaseUrl, listingBaseUrl));
        return cell;
    }

    const segments = extractInlineSegments(content);
    const hasToken = segments.some(s => s.type === "token");

    if (hasToken) {
        const container = document.createElement("div");
        container.className = "blog-md-content";

        for (const seg of segments) {
            if (seg.type === "text") {
                const textDiv = document.createElement("div");
                textDiv.innerHTML = window.marked.parse(seg.value);
                while (textDiv.firstChild) container.appendChild(textDiv.firstChild);
            } else {
                container.appendChild(renderMediaToken(seg.token, mediaBaseUrl, listingBaseUrl));
            }
        }

        cell.appendChild(container);
        return cell;
    }

    const div = document.createElement("div");
    div.className = "blog-md-content";
    div.innerHTML = window.marked.parse(content);
    cell.appendChild(div);
    return cell;
}

let _mobileRowsBuilder = null;

export function setMobileRowsBuilder(fn) {
    _mobileRowsBuilder = fn;
}

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
            const cell = renderCell(sides.full, mediaBaseUrl, listingBaseUrl);
            if (isMediaOnlyBlock(sides.full)) cell.classList.add("blog-cell--image-left");
            rowEl.appendChild(cell);

        } else {
            rowEl.classList.add("blog-row--half");

            const hasA = sides.a !== undefined;
            const hasB = sides.b !== undefined;
            const aIsMedia = hasA && isMediaOnlyBlock(sides.a);
            const bIsMedia = hasB && isMediaOnlyBlock(sides.b);

            if (hasA) {
                const cellA = renderCell(sides.a, mediaBaseUrl, listingBaseUrl);
                if (aIsMedia)              cellA.classList.add("blog-cell--image-left");
                else if (hasB && bIsMedia) cellA.classList.add("blog-cell--text-beside-image");
                rowEl.appendChild(cellA);
            } else {
                const empty = document.createElement("div");
                empty.className = "blog-cell blog-cell--empty";
                rowEl.appendChild(empty);
            }

            if (hasB) {
                const cellB = renderCell(sides.b, mediaBaseUrl, listingBaseUrl);
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

export function buildRows(rawMd, mediaBaseUrl, listingBaseUrl) {
    const wrapper = document.createElement("div");
    wrapper.className = BLOG_ROWS_WRAPPER_CLASS;
    wrapper.style.display = "contents";
    wrapper.__blogRenderArgs = { rawMd, mediaBaseUrl, listingBaseUrl };
    wrapper.appendChild(_renderRowsFragment(rawMd, mediaBaseUrl, listingBaseUrl));
    return wrapper;
}

export function rerenderAllBlogContent() {
    const wrappers = document.querySelectorAll(`.${BLOG_ROWS_WRAPPER_CLASS}`);
    for (const wrapper of wrappers) {
        const args = wrapper.__blogRenderArgs;
        if (!args) continue;
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        wrapper.appendChild(_renderRowsFragment(args.rawMd, args.mediaBaseUrl, args.listingBaseUrl));
    }
}

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
        dateEl.textContent = Array.isArray(date) ? formatDateRanges(date) : date;
        header.appendChild(dateEl);
    }

    article.appendChild(header);
    article.appendChild(buildRows(rawMd, mediaBaseUrl, listingBaseUrl));

    return article;
}

export function createPlaceholder(elementId, minHeight = 400) {
    const div = document.createElement("div");
    div.className = "blog-placeholder";
    div.id = `placeholder-${elementId}`;
    div.dataset.slug = elementId;
    div.style.minHeight = `${minHeight}px`;
    return div;
}

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
