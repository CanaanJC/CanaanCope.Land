console.log("Projects module loaded");

const MARKED_CDN = "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js";
const PRELOAD_AHEAD = 2;

// ── Guard: only run on /projects or /small-projects pages ────────────────────

const _pathParts = window.location.pathname.split("/").filter(Boolean);
const _rootSection = _pathParts[0];
const IS_PROJECTS_PAGE = _rootSection === "projects" || _rootSection === "small-projects";
const IS_BLOCKED_PAGE  = !!window.__BLOCKED_SLUG__;

if (!IS_PROJECTS_PAGE && !IS_BLOCKED_PAGE) {
    // This script was loaded on a page that isn't a projects listing or blocked
    // project — do nothing.
    throw new Error("[projects.js] Not a projects page, halting module.");
}

// ── Detect section ────────────────────────────────────────────────────────────

function detectSection() {
    if (window.__BLOCKED_SECTION__) return window.__BLOCKED_SECTION__;
    if (_rootSection === "small-projects") return "small-projects";
    return "projects";
}

const SECTION = detectSection();

async function loadMarked() {
    if (window.marked) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = MARKED_CDN;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getEndDate(date) {
    if (!date) return null;
    if (Array.isArray(date)) return date.length >= 2 ? date[1] : date[0];
    return date;
}

function parseDateStr(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

function sortManifestByEndDate(manifest) {
    return [...manifest].sort((a, b) => {
        const da = parseDateStr(getEndDate(a.date));
        const db = parseDateStr(getEndDate(b.date));
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db - da;
    });
}

// ── Wait for topbar ───────────────────────────────────────────────────────────

function waitForTopbar(maxMs = 2000) {
    const el = document.getElementById("topbarList");
    if (!el) return Promise.resolve(null);
    if (el.hasChildNodes()) return Promise.resolve(el);
    return new Promise(resolve => {
        const observer = new MutationObserver(() => {
            if (el.hasChildNodes()) { observer.disconnect(); resolve(el); }
        });
        observer.observe(el, { childList: true });
        setTimeout(() => { observer.disconnect(); resolve(el); }, maxMs);
    });
}

// ── Topbar By Month dropdown ──────────────────────────────────────────────────

function scrollToSlug(slug) {
    const el = document.getElementById(slug) || document.getElementById(`placeholder-${slug}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildTopbarMonthNav(sortedManifest) {
    const yearToSlug  = new Map();
    const monthToSlug = new Map();
    const yearMonths  = new Map();

    for (const project of sortedManifest) {
        const endDate = getEndDate(project.date);
        if (!endDate) continue;
        const parts = endDate.split("/");
        if (parts.length < 2) continue;
        const year  = parts[0];
        const month = parts[1].padStart(2, "0");
        const key   = `${year}/${month}`;
        if (!yearToSlug.has(year))  yearToSlug.set(year, project.slug);
        if (!monthToSlug.has(key))  monthToSlug.set(key, project.slug);
        if (!yearMonths.has(year))  yearMonths.set(year, new Set());
        yearMonths.get(year).add(month);
    }

    const years = [...yearMonths.keys()].sort((a, b) => Number(b) - Number(a));

    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "month-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = "By Month";
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const year of years) {
        const yearBtn = document.createElement("button");
        yearBtn.className = "topbar-dropdown__item topbar-month-nav--year";
        yearBtn.textContent = year;
        yearBtn.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.remove("open");
            scrollToSlug(yearToSlug.get(year));
        });
        menu.appendChild(yearBtn);

        const months = [...yearMonths.get(year)].sort((a, b) => Number(b) - Number(a));
        for (const month of months) {
            const monthBtn = document.createElement("button");
            monthBtn.className = "topbar-dropdown__item topbar-month-nav--month";
            monthBtn.textContent = month;
            monthBtn.addEventListener("click", (e) => {
                e.preventDefault();
                wrapper.classList.remove("open");
                scrollToSlug(monthToSlug.get(`${year}/${month}`));
            });
            menu.appendChild(monthBtn);
        }
    }

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

async function injectTopbarMonthNav(sortedManifest) {
    if (!sortedManifest.length) return;
    const topbar = await waitForTopbar();
    if (!topbar) return;
    for (const el of [...topbar.querySelectorAll(".topbar-dropdown")]) el.remove();
    const logo = topbar.querySelector(".topbar-logo");
    const nav  = buildTopbarMonthNav(sortedManifest);
    if (logo && logo.nextSibling) topbar.insertBefore(nav, logo.nextSibling);
    else topbar.appendChild(nav);
}

// ── Gallery modal ─────────────────────────────────────────────────────────────

let _escListener = null;

function closeGalleryModal() {
    const overlay = document.getElementById("gallery-modal-overlay");
    if (overlay) overlay.remove();
    document.body.classList.remove("gallery-open");
    if (_escListener) {
        document.removeEventListener("keydown", _escListener);
        _escListener = null;
    }
}

function openGalleryModal(files, slug, folderName) {
    closeGalleryModal();

    const colCount = Math.min(files.length, 3);

    const overlay = document.createElement("div");
    overlay.id = "gallery-modal-overlay";
    overlay.className = "gallery-overlay";
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeGalleryModal();
    });

    const card = document.createElement("div");
    card.className = "gallery-card";

    const closeBtn = document.createElement("button");
    closeBtn.className = "gallery-close";
    closeBtn.setAttribute("aria-label", "Close gallery");
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none">
        <line x1="2" y1="2" x2="16" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="2" x2="2" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    closeBtn.addEventListener("click", closeGalleryModal);

    const columns = document.createElement("div");
    columns.className = "gallery-columns";

    const cols = Array.from({ length: colCount }, () => {
        const col = document.createElement("div");
        col.className = "gallery-col";
        return col;
    });

    files.forEach((file, i) => {
        const isVid = /\.mp4$/i.test(file);
        const item  = document.createElement("div");
        item.className = "gallery-item";

        if (isVid) {
            const video = document.createElement("video");
            video.className = "gallery-media";
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;
            const source = document.createElement("source");
            source.src  = `/${SECTION}/${slug}/media/${folderName}/${file}`;
            source.type = "video/mp4";
            video.appendChild(source);
            item.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.className = "gallery-media";
            img.src = `/${SECTION}/${slug}/media/${folderName}/${file}`;
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
    document.body.classList.add("gallery-open");

    _escListener = (e) => { if (e.key === "Escape") closeGalleryModal(); };
    document.addEventListener("keydown", _escListener);
}

// ── Content parsing ───────────────────────────────────────────────────────────

function parseContentMd(raw) {
    const blockRegex = /\[P([^\]]+)\]([\s\S]*?)\[\/P\1\]/g;
    const blocks = [];
    let match;
    while ((match = blockRegex.exec(raw)) !== null) {
        blocks.push({ tag: match[1].trim(), content: match[2].trim() });
    }
    return blocks;
}

function isImageBlock(content) {
    return /^[\w\-]+\.(png|jpg|jpeg|gif|webp|svg)$/i.test(content.trim());
}

function isVideoBlock(content) {
    return /^[\w\-]+\.mp4$/i.test(content.trim());
}

function isAudioBlock(content) {
    return /^[\w\-]+\.mp3$/i.test(content.trim());
}

function isFolderBlock(content) {
    return /^\.\/[\w\-]+$/.test(content.trim());
}

function groupIntoRows(blocks) {
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

// ── Folder cell ───────────────────────────────────────────────────────────────

function renderFolderCell(folderName, slug) {
    const cell = document.createElement("div");
    cell.className = "project-cell project-cell--image-left";

    const outer = document.createElement("div");
    outer.className = "project-folder-outer";

    const wrap = document.createElement("span");
    wrap.className = "project-image-wrap";
    outer.appendChild(wrap);
    cell.appendChild(outer);

    fetch(`/${SECTION}/${slug}/media-listing/${folderName}?_=${Date.now()}`, { cache: "no-store" })
        .then(r => r.json())
        .then(files => {
            if (!files.length) return;

            const first     = files[0];
            const remaining = files.length - 1;
            const isVid     = /\.mp4$/i.test(first);

            if (isVid) {
                const video = document.createElement("video");
                video.className = "project-video";
                video.controls = true;
                video.preload = "auto";
                video.playsInline = true;
                const source = document.createElement("source");
                source.src  = `/${SECTION}/${slug}/media/${folderName}/${first}`;
                source.type = "video/mp4";
                video.appendChild(source);
                wrap.appendChild(video);
            } else {
                const img = document.createElement("img");
                img.className = "project-image";
                img.src = `/${SECTION}/${slug}/media/${folderName}/${first}`;
                img.alt = first;
                img.loading = "lazy";
                wrap.appendChild(img);
            }

            outer.style.cursor = "pointer";
            outer.addEventListener("click", () => openGalleryModal(files, slug, folderName));

            if (remaining > 0) {
                const badge = document.createElement("span");
                badge.className = "project-folder-badge";
                badge.textContent = `+${remaining}`;
                outer.appendChild(badge);
            }
        })
        .catch(err => console.error(`Failed to load media folder "${folderName}":`, err));

    return cell;
}

// ── Cell renderer ─────────────────────────────────────────────────────────────

function renderCell(content, slug, isImage, isVideo, isAudio, isFolder) {
    if (isFolder) return renderFolderCell(content.trim().slice(2), slug);

    const cell = document.createElement("div");
    cell.className = "project-cell";

    if (isImage) {
        const wrap = document.createElement("span");
        wrap.className = "project-image-wrap";
        const img = document.createElement("img");
        img.className = "project-image";
        img.src = `/${SECTION}/${slug}/media/${content.trim()}`;
        img.alt = content.trim();
        img.loading = "lazy";
        wrap.appendChild(img);
        cell.appendChild(wrap);

    } else if (isVideo) {
        const wrap = document.createElement("span");
        wrap.className = "project-image-wrap project-video-wrap";
        const video = document.createElement("video");
        video.className = "project-video";
        video.controls = true;
        video.preload = "auto";
        video.playsInline = true;
        const source = document.createElement("source");
        source.src  = `/${SECTION}/${slug}/media/${content.trim()}`;
        source.type = "video/mp4";
        video.appendChild(source);
        wrap.appendChild(video);
        cell.appendChild(wrap);

    } else if (isAudio) {
        const wrap = document.createElement("div");
        wrap.className = "project-audio-wrap";
        const audio = document.createElement("audio");
        audio.className = "project-audio";
        audio.controls = true;
        audio.preload = "metadata";
        const source = document.createElement("source");
        source.src  = `/${SECTION}/${slug}/media/${content.trim()}`;
        source.type = "audio/mpeg";
        audio.appendChild(source);
        wrap.appendChild(audio);
        cell.appendChild(wrap);

    } else {
        const div = document.createElement("div");
        div.className = "md-content";
        div.innerHTML = window.marked.parse(content);
        cell.appendChild(div);
    }

    return cell;
}

// ── Project DOM builder ───────────────────────────────────────────────────────

function buildProjectDOM(slug, config, rawMd) {
    const article = document.createElement("article");
    article.className = "project-block";
    article.id = slug;

    const header = document.createElement("div");
    header.className = "project-header";

    const title = document.createElement("h2");
    title.className = "project-title";
    title.textContent = config.name || slug;

    const dateEl = document.createElement("div");
    dateEl.className = "project-date";
    if (Array.isArray(config.date) && config.date.length === 2) {
        dateEl.textContent = `${config.date[0]} – ${config.date[1]}`;
    } else if (config.date) {
        dateEl.textContent = Array.isArray(config.date) ? config.date[0] : config.date;
    }

    header.appendChild(title);
    if (config.date) header.appendChild(dateEl);
    article.appendChild(header);

    const rows = groupIntoRows(parseContentMd(rawMd));

    for (const row of rows) {
        const { sides } = row;
        const rowEl = document.createElement("div");
        rowEl.className = "project-row";

        if (sides.full !== undefined) {
            rowEl.classList.add("project-row--full");
            const isImg = isImageBlock(sides.full);
            const isVid = isVideoBlock(sides.full);
            const isAud = isAudioBlock(sides.full);
            const isDir = isFolderBlock(sides.full);
            const cell  = renderCell(sides.full, slug, isImg, isVid, isAud, isDir);
            if (isImg || isVid || isDir) cell.classList.add("project-cell--image-left");
            rowEl.appendChild(cell);

        } else {
            rowEl.classList.add("project-row--half");

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
                const cellA = renderCell(sides.a, slug, aIsImg, aIsVid, aIsAud, aIsDir);
                if (aIsMedia)              cellA.classList.add("project-cell--image-left");
                else if (hasB && bIsMedia) cellA.classList.add("project-cell--text-beside-image");
                rowEl.appendChild(cellA);
            } else {
                const empty = document.createElement("div");
                empty.className = "project-cell project-cell--empty";
                rowEl.appendChild(empty);
            }

            if (hasB) {
                const cellB = renderCell(sides.b, slug, bIsImg, bIsVid, bIsAud, bIsDir);
                if (bIsMedia)              cellB.classList.add("project-cell--image-right");
                else if (hasA && aIsMedia) cellB.classList.add("project-cell--text-beside-image");
                rowEl.appendChild(cellB);
            } else {
                const empty = document.createElement("div");
                empty.className = "project-cell project-cell--empty";
                rowEl.appendChild(empty);
            }
        }

        article.appendChild(rowEl);
    }

    return article;
}

// ── Lazy loader ───────────────────────────────────────────────────────────────

function createPlaceholder(slug, height = 400) {
    const div = document.createElement("div");
    div.className = "project-placeholder";
    div.id = `placeholder-${slug}`;
    div.dataset.slug = slug;
    div.style.minHeight = `${height}px`;
    return div;
}

async function loadProjectIntoContainer(slug, container) {
    try {
        const [configRes, mdRes] = await Promise.all([
            fetch(`/${SECTION}/${slug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
            fetch(`/${SECTION}/${slug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
        ]);
        if (!configRes.ok || !mdRes.ok) throw new Error("Failed to fetch project files");
        const config = await configRes.json();
        const rawMd  = await mdRes.text();
        const dom = buildProjectDOM(slug, config, rawMd);
        container.replaceWith(dom);
        return dom;
    } catch (err) {
        console.error(`Failed to load project "${slug}":`, err);
        return null;
    }
}

function setupScrollTracking(slugs) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const slug   = entry.target.id;
                    const newUrl = `/${SECTION}/${slug}`;
                    if (window.location.pathname !== newUrl) history.replaceState(null, "", newUrl);
                }
            }
        },
        { rootMargin: "0px 0px -80% 0px", threshold: 0 }
    );
    for (const slug of slugs) {
        const el = document.getElementById(slug);
        if (el) observer.observe(el);
    }
}

function setupLazyLoading(slugs) {
    const preloadMargin = `${PRELOAD_AHEAD * 100}%`;
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const placeholder = entry.target;
                const slug = placeholder.dataset.slug;
                if (!slug) continue;
                observer.unobserve(placeholder);
                loadProjectIntoContainer(slug, placeholder).then(dom => {
                    if (dom) setupScrollTracking([slug]);
                });
            }
        },
        { rootMargin: `0px 0px ${preloadMargin} 0px`, threshold: 0 }
    );
    for (const slug of slugs) {
        const placeholder = document.getElementById(`placeholder-${slug}`);
        if (placeholder) observer.observe(placeholder);
    }
}

// ── Blocked project mode ──────────────────────────────────────────────────────

async function loadBlockedProject(slug) {
    const container = document.getElementById("projects-container");
    if (!container) return;
    await loadMarked();
    try {
        const [configRes, mdRes] = await Promise.all([
            fetch(`/${SECTION}/${slug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
            fetch(`/${SECTION}/${slug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
        ]);
        if (!configRes.ok || !mdRes.ok) throw new Error();
        const config = await configRes.json();
        const rawMd  = await mdRes.text();
        container.appendChild(buildProjectDOM(slug, config, rawMd));
    } catch (err) {
        console.error(`Failed to load blocked project "${slug}":`, err);
    }
}

// ── Normal mode ───────────────────────────────────────────────────────────────

async function loadProjects() {
    const container = document.getElementById("projects-container");
    if (!container) return;

    await loadMarked();

    let manifest;
    try {
        const res = await fetch(`/${SECTION}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        manifest = await res.json();
    } catch (err) {
        console.error("Failed to load project manifest:", err);
        return;
    }

    if (!manifest.length) {
        container.innerHTML = `<p style="color:var(--muted);padding:48px;">No projects yet.</p>`;
        return;
    }

    manifest = sortManifestByEndDate(manifest);
    injectTopbarMonthNav(manifest);

    const urlSlug = (() => {
        const hash = window.location.hash.replace("#", "");
        if (hash) return hash;
        const parts = window.location.pathname.split("/").filter(Boolean);
        return parts.length >= 2 ? parts[1] : null;
    })();

    const targetIndex = urlSlug ? Math.max(manifest.findIndex(p => p.slug === urlSlug), 0) : 0;
    const eagerCutoff = targetIndex + PRELOAD_AHEAD;

    const eagerSlugs = [];
    const lazySlugs  = [];
    for (let i = 0; i < manifest.length; i++) {
        (i <= eagerCutoff ? eagerSlugs : lazySlugs).push(manifest[i].slug);
    }

    const allSlugs = manifest.map(p => p.slug);

    const eagerResults = await Promise.all(
        eagerSlugs.map(async slug => {
            try {
                const [configRes, mdRes] = await Promise.all([
                    fetch(`/${SECTION}/${slug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
                    fetch(`/${SECTION}/${slug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
                ]);
                if (!configRes.ok || !mdRes.ok) throw new Error();
                const config = await configRes.json();
                const rawMd  = await mdRes.text();
                return { slug, dom: buildProjectDOM(slug, config, rawMd) };
            } catch {
                console.error(`Failed to eagerly load "${slug}"`);
                return { slug, dom: createPlaceholder(slug) };
            }
        })
    );

    for (let i = 0; i < allSlugs.length; i++) {
        const slug = allSlugs[i];
        if (i > 0) {
            const hr = document.createElement("hr");
            hr.className = "project-divider";
            container.appendChild(hr);
        }
        const eager = eagerResults.find(r => r.slug === slug);
        container.appendChild(eager ? eager.dom : createPlaceholder(slug));
    }

    if (urlSlug) {
        const target = document.getElementById(urlSlug);
        if (target) setTimeout(() => target.scrollIntoView({ behavior: "instant", block: "start" }), 50);
    }

    setupScrollTracking(eagerSlugs);
    if (lazySlugs.length > 0) setupLazyLoading(lazySlugs);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    if (window.__BLOCKED_SLUG__) loadBlockedProject(window.__BLOCKED_SLUG__);
    else loadProjects();
});
