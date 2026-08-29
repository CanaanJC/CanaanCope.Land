// ─────────────────────────────────────────────────────────────────────────────
// mobile.js — Mobile patch overlay
//
// Activates a mobile layout when viewport width ≤ 768px. Manages:
//   - body.mobile class toggle
//   - floating hamburger button + slide-out menu:
//       • logo from media/logo.png
//       • top nav section: on the homepage, the flat libraries list
//         (config/libraries.json, hidden libraries excluded — same rule as
//         the desktop topbar dropdown); once inside a library, that same
//         section is replaced with the library's own manifest-driven
//         nav tree (bold year → months for date-mode libraries, or the
//         nested title tree for others) — a direct mirror of the
//         desktop topbar dropdown's contents, always expanded, and shown
//         regardless of that library's own hidden flag (hidden only
//         affects whether it appears in the flat list, not its own page)
//       • social links from sidebar.json
//   - mobile blog renderer (registered with lib-blog at module load)
//   - re-render of all blog content when the viewport mode toggles
//
// Mobile blog rendering rules:
//   - [P…] blocks: pure-media P blocks (a sole token, or a multi-token
//     stack) are skipped here — that content belongs in a [M…] block
//     instead. Otherwise, the block's nested [M…]…[/M…] sub-blocks are
//     split out first, then each remaining text run is further split on
//     any inline <...> tokens — text segments render as markdown, token
//     segments render as full-width media cells, all in original order.
//   - [M…] blocks (top-level, or extracted from inside a [P…]): rendered as
//     full-width media via the shared renderCell.
// ─────────────────────────────────────────────────────────────────────────────

import {
    setMobileRowsBuilder,
    parseAllBlocks,
    isMediaOnlyBlock,
    extractInlineSegments,
    renderMediaToken,
    renderCell,
    rerenderAllBlogContent,
    getEndDate,
    sortByEndDate,
} from "./lib-blog.js";

console.log("Mobile module loaded");

const MOBILE_BREAKPOINT   = 768;
const LOGO_URL            = "/media/logo.png";
const LIBRARIES_DATA_URL  = "/config/libraries.json";
const SIDEBAR_DATA_URL    = "/json/sidebar.json";

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

const INNER_M_BLOCK_REGEX = /\[M([^\]]+)\]([\s\S]*?)\[\/M\1\]/g;

let _isMobile       = false;
let _menuBuilt      = false;
let _menuOpen       = false;

// ── Mobile blog renderer ─────────────────────────────────────────────────────

function buildMobileRows(rawMd, mediaBaseUrl, listingBaseUrl) {
    const frag   = document.createDocumentFragment();
    const blocks = parseAllBlocks(rawMd);

    for (const block of blocks) {
        if (block.kind === "P") {
            renderMobilePBlock(block.content, mediaBaseUrl, listingBaseUrl, frag);
        } else if (block.kind === "M") {
            renderMobileMediaRow(block.content, mediaBaseUrl, listingBaseUrl, frag);
        }
    }

    return frag;
}

// Renders one markdown-with-possible-inline-tokens text run as one or more
// full-width rows: consecutive plain text collapses into a single markdown
// row, and each inline token becomes its own full-width media row.
function renderMobileTextRun(text, mediaBaseUrl, listingBaseUrl, frag) {
    const inlineSegments = extractInlineSegments(text);
    const hasToken = inlineSegments.some(s => s.type === "token");

    if (!hasToken) {
        const clean = text.trim();
        if (!clean) return;
        const row = document.createElement("div");
        row.className = "blog-row blog-row--full";
        const cell = document.createElement("div");
        cell.className = "blog-cell";
        const md = document.createElement("div");
        md.className = "blog-md-content";
        md.innerHTML = window.marked.parse(clean);
        cell.appendChild(md);
        row.appendChild(cell);
        frag.appendChild(row);
        return;
    }

    for (const seg of inlineSegments) {
        if (seg.type === "text") {
            const clean = seg.value.trim();
            if (!clean) continue;
            const row = document.createElement("div");
            row.className = "blog-row blog-row--full";
            const cell = document.createElement("div");
            cell.className = "blog-cell";
            const md = document.createElement("div");
            md.className = "blog-md-content";
            md.innerHTML = window.marked.parse(clean);
            cell.appendChild(md);
            row.appendChild(cell);
            frag.appendChild(row);
        } else {
            const row = document.createElement("div");
            row.className = "blog-row blog-row--full";
            const cell = document.createElement("div");
            cell.className = "blog-cell blog-cell--image-left";
            cell.appendChild(renderMediaToken(seg.token, mediaBaseUrl, listingBaseUrl));
            row.appendChild(cell);
            frag.appendChild(row);
        }
    }
}

// Render a single P block on mobile. The content may contain nested
// [M…]…[/M…] sub-blocks — split on those first, alternating text and media
// segments; each text segment is then further split on inline <...> tokens.
function renderMobilePBlock(content, mediaBaseUrl, listingBaseUrl, frag) {
    const trimmed = content.trim();
    if (!trimmed) return;

    // Skip entirely if the whole block is pure media (a sole token or a
    // stack) — that content belongs in an [M…] block instead on mobile.
    if (isMediaOnlyBlock(trimmed)) return;

    // Split content on nested [M…]…[/M…] blocks
    const segments = [];
    let lastIndex  = 0;
    const regex = new RegExp(INNER_M_BLOCK_REGEX.source, INNER_M_BLOCK_REGEX.flags);
    let m;
    while ((m = regex.exec(trimmed)) !== null) {
        if (m.index > lastIndex) {
            segments.push({ type: "text",  value: trimmed.substring(lastIndex, m.index) });
        }
        segments.push({ type: "media", value: m[2].trim() });
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < trimmed.length) {
        segments.push({ type: "text", value: trimmed.substring(lastIndex) });
    }
    if (segments.length === 0) segments.push({ type: "text", value: trimmed });

    for (const seg of segments) {
        if (seg.type === "text") {
            renderMobileTextRun(seg.value, mediaBaseUrl, listingBaseUrl, frag);
        } else {
            renderMobileMediaRow(seg.value, mediaBaseUrl, listingBaseUrl, frag);
        }
    }
}

// Render a single full-width media row on mobile. Used both for top-level
// [M…] blocks and for [M…] segments extracted from inside a [P…] block.
function renderMobileMediaRow(content, mediaBaseUrl, listingBaseUrl, frag) {
    const c = content.trim();
    if (!c) return;

    const row = document.createElement("div");
    row.className = "blog-row blog-row--full";

    const cell = renderCell(c, mediaBaseUrl, listingBaseUrl);
    if (isMediaOnlyBlock(c)) cell.classList.add("blog-cell--image-left");

    row.appendChild(cell);
    frag.appendChild(row);
}

// Register immediately at module-load time so lib-blog has the hook before
// any consumer module calls buildRows.
setMobileRowsBuilder(buildMobileRows);

// ── Detection ────────────────────────────────────────────────────────────────

function checkMobile() {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

// ── DOM refs ─────────────────────────────────────────────────────────────────

function getBurger()       { return document.getElementById("mobileBurger"); }
function getMenu()         { return document.getElementById("mobileMenu"); }
function getMenuOverlay()  { return document.getElementById("mobileMenuOverlay"); }
function getProjectsSlot() { return document.getElementById("mobileMenuProjectsSlot"); }
function getSidebarSlot()  { return document.getElementById("mobileMenuSidebarSlot"); }

// ── Build hamburger button ───────────────────────────────────────────────────

function buildBurger() {
    if (getBurger()) return;

    const btn = document.createElement("button");
    btn.id = "mobileBurger";
    btn.className = "mobile-burger";
    btn.setAttribute("aria-label", "Open menu");
    btn.setAttribute("type", "button");

    const icon = document.createElement("span");
    icon.className = "mobile-burger__icon";
    for (let i = 0; i < 3; i++) {
        const bar = document.createElement("span");
        bar.className = "mobile-burger__bar";
        icon.appendChild(bar);
    }
    btn.appendChild(icon);

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
    });

    document.body.appendChild(btn);
}

// ── Build slide-out menu ─────────────────────────────────────────────────────

function buildMenuShell() {
    if (getMenu()) return;

    const overlay = document.createElement("div");
    overlay.id = "mobileMenuOverlay";
    overlay.className = "mobile-menu-overlay";
    overlay.addEventListener("click", () => closeMenu());
    document.body.appendChild(overlay);

    const menu = document.createElement("aside");
    menu.id = "mobileMenu";
    menu.className = "mobile-menu";
    menu.setAttribute("aria-label", "Mobile navigation");

    const logoLink = document.createElement("a");
    logoLink.className = "mobile-menu__logo";
    logoLink.href = "/";
    logoLink.id = "mobileMenuLogo";
    logoLink.setAttribute("aria-label", "Home");
    const logoImg = document.createElement("img");
    logoImg.className = "mobile-menu__logo-img";
    logoImg.alt = "Site logo";
    logoImg.src = LOGO_URL;
    logoImg.addEventListener("error", () => {
        logoImg.src = FALLBACK_ICON;
        logoImg.classList.add("fallback");
    });
    logoLink.appendChild(logoImg);
    logoLink.addEventListener("click", handleNavClick);
    menu.appendChild(logoLink);

    const projectsSlot = document.createElement("div");
    projectsSlot.id = "mobileMenuProjectsSlot";
    menu.appendChild(projectsSlot);

    const div1 = document.createElement("hr");
    div1.className = "mobile-menu__divider";
    menu.appendChild(div1);

    const sidebarSlot = document.createElement("div");
    sidebarSlot.id = "mobileMenuSidebarSlot";
    menu.appendChild(sidebarSlot);

    document.body.appendChild(menu);
}

// ── Library nav helpers (mirrors library.js's manifest-tree logic) ──────────

function entryId(slugPath) {
    return slugPath.join("--");
}

function scrollToMobileId(id) {
    closeMenu();
    setTimeout(() => {
        const el = document.getElementById(id) || document.getElementById(`placeholder-${id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 260);
}

function sortLibraryManifest(library, manifest) {
    if (library.useDates) return sortByEndDate(manifest);
    return [...manifest].sort((a, b) => {
        const segA = a.segments, segB = b.segments;
        const len = Math.max(segA.length, segB.length);
        for (let i = 0; i < len; i++) {
            const sa = segA[i], sb = segB[i];
            if (!sa) return -1;
            if (!sb) return 1;
            if (sa.num !== sb.num) return sa.num - sb.num;
            const c = sa.title.localeCompare(sb.title);
            if (c !== 0) return c;
        }
        return 0;
    });
}

// Date-mode nav: bold year, indented months underneath (matches desktop's
// buildTopbarDateNav content exactly, just always expanded instead of
// living behind a hover dropdown).
function buildMobileDateNav(sortedManifest, container) {
    const yearToId   = new Map();
    const monthToId  = new Map();
    const yearMonths = new Map();

    for (const entry of sortedManifest) {
        const endDate = getEndDate(entry.date);
        if (!endDate) continue;
        const parts = endDate.split("/");
        if (parts.length < 2) continue;
        const year  = parts[0];
        const month = parts[1].padStart(2, "0");
        const key   = `${year}/${month}`;
        const id    = entryId(entry.slugPath);
        if (!yearToId.has(year))   yearToId.set(year, id);
        if (!monthToId.has(key))   monthToId.set(key, id);
        if (!yearMonths.has(year)) yearMonths.set(year, new Set());
        yearMonths.get(year).add(month);
    }

    const years = [...yearMonths.keys()].sort((a, b) => Number(b) - Number(a));

    for (const year of years) {
        const yearBtn = document.createElement("button");
        yearBtn.className = "mobile-menu__item topbar-tree-item topbar-tree-item--group";
        yearBtn.dataset.level = "0";
        yearBtn.textContent = year;
        yearBtn.addEventListener("click", (e) => {
            e.preventDefault();
            scrollToMobileId(yearToId.get(year));
        });
        container.appendChild(yearBtn);

        const months = [...yearMonths.get(year)].sort((a, b) => Number(b) - Number(a));
        for (const month of months) {
            const monthBtn = document.createElement("button");
            monthBtn.className = "mobile-menu__item topbar-tree-item topbar-tree-item--leaf";
            monthBtn.dataset.level = "1";
            monthBtn.textContent = month;
            monthBtn.addEventListener("click", (e) => {
                e.preventDefault();
                scrollToMobileId(monthToId.get(`${year}/${month}`));
            });
            container.appendChild(monthBtn);
        }
    }
}

// Title-mode nav: recursive N-level tree from folder segments (matches
// desktop's buildTopbarTreeNav content exactly).
function buildLibraryTree(manifest) {
    const root = { children: new Map() };
    for (const entry of manifest) {
        let node = root;
        for (const seg of entry.segments) {
            if (!node.children.has(seg.slug)) {
                node.children.set(seg.slug, {
                    slug: seg.slug,
                    num: seg.num,
                    title: seg.title,
                    children: new Map(),
                    entry: null,
                });
            }
            node = node.children.get(seg.slug);
        }
        node.entry = entry;
    }
    return root;
}

function firstLeafSlugPath(node) {
    if (node.entry) return node.entry.slugPath;
    const sorted = [...node.children.values()].sort((a, b) => a.num - b.num || a.title.localeCompare(b.title));
    return sorted.length ? firstLeafSlugPath(sorted[0]) : null;
}

function renderMobileTreeNodes(node, depth, container) {
    const children = [...node.children.values()]
        .sort((a, b) => a.num - b.num || a.title.localeCompare(b.title));

    for (const child of children) {
        const isLeaf = child.children.size === 0;

        const btn = document.createElement("button");
        btn.className = `mobile-menu__item topbar-tree-item ${isLeaf ? "topbar-tree-item--leaf" : "topbar-tree-item--group"}`;
        btn.dataset.level = String(depth);
        btn.textContent = child.title;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const targetSlugPath = isLeaf ? child.entry.slugPath : firstLeafSlugPath(child);
            if (targetSlugPath) scrollToMobileId(entryId(targetSlugPath));
        });
        container.appendChild(btn);

        if (!isLeaf) renderMobileTreeNodes(child, depth + 1, container);
    }
}

function buildMobileTreeNav(sortedManifest, container) {
    const tree = buildLibraryTree(sortedManifest);
    renderMobileTreeNodes(tree, 0, container);
}

// Resolves which library (if any) the current page belongs to — matches
// the first URL path segment, or the blocked/embed marker set by
// buildLibraryEmbedHtml for `block: true` entries. Works regardless of a
// library's own `hidden` flag — hidden only affects whether it shows up in
// the flat nav list below, never whether its own page functions normally.
function getCurrentLibrary(libraries) {
    const blockedPath = window.__LIBRARY_BLOCKED_PATH__;
    if (blockedPath) return libraries.find(l => l.path === blockedPath) || null;
    const seg = window.location.pathname.split("/").filter(Boolean)[0];
    return libraries.find(l => l.path === seg) || null;
}

async function populateLibraryNav(container, library) {
    try {
        const res = await fetch(`/${library.path}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        let manifest = await res.json();
        if (!Array.isArray(manifest) || manifest.length === 0) return;

        manifest = sortLibraryManifest(library, manifest);

        if (library.useDates) buildMobileDateNav(manifest, container);
        else buildMobileTreeNav(manifest, container);
    } catch (err) {
        console.error(`Mobile: failed to load manifest for "${library.path}":`, err);
    }
}

// ── Populate menu from JSON ──────────────────────────────────────────────────

async function populateMenu() {
    const projectsSlot = getProjectsSlot();
    try {
        const res = await fetch(`${LIBRARIES_DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        const libraries = res.ok ? await res.json() : [];

        if (projectsSlot && Array.isArray(libraries)) {
            projectsSlot.innerHTML = "";

            const currentLibrary = getCurrentLibrary(libraries);
            if (currentLibrary) {
                // Inside a library page — show that library's own manifest
                // nav instead of the flat libraries list. Shown regardless
                // of this library's own `hidden` flag — hidden only hides
                // it from the flat list below, not from its own page nav.
                await populateLibraryNav(projectsSlot, currentLibrary);
            } else {
                // Homepage (or anywhere else not inside a library) — flat
                // libraries list, matching the desktop dropdown's items.
                // Hidden libraries are excluded here, same rule as the
                // desktop topbar dropdown.
                const visibleLibraries = libraries.filter(lib => lib && !lib.hidden);
                for (const lib of visibleLibraries) {
                    if (!lib.path) continue;
                    projectsSlot.appendChild(buildMenuLink({
                        name: lib.name || lib.path,
                        link: `/${lib.path}`,
                        icon: lib.icon,
                    }));
                }
            }
        }
    } catch (err) {
        console.error("Mobile: failed to load libraries.json:", err);
    }

    try {
        const res = await fetch(`${SIDEBAR_DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
            const data = await res.json();
            const sidebarSlot = getSidebarSlot();
            if (sidebarSlot && Array.isArray(data)) {
                sidebarSlot.innerHTML = "";
                for (const item of data) {
                    if (!item || !item.link) continue;
                    sidebarSlot.appendChild(buildMenuLink({
                        name: item.text,
                        link: item.link,
                        icon: item.image,
                    }));
                }
            }
        }
    } catch (err) {
        console.error("Mobile: failed to load sidebar.json:", err);
    }
}

// ── Menu link builder ────────────────────────────────────────────────────────

function buildMenuLink(item) {
    const a = document.createElement("a");
    a.className = "mobile-menu__item";
    a.href = item.link || "#";
    if (item.link && /^https?:\/\//.test(item.link)) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
    }

    const iconSlot = document.createElement("span");
    iconSlot.className = "mobile-menu__icon-slot";

    if (item.icon && typeof item.icon === "string" && item.icon.trim() !== "") {
        const img = document.createElement("img");
        img.className = "mobile-menu__icon";
        img.alt = item.name || "";
        img.src = item.icon;
        img.addEventListener("error", () => {
            img.src = FALLBACK_ICON;
            img.classList.add("fallback");
        });
        iconSlot.appendChild(img);
    }

    const label = document.createElement("span");
    label.className = "mobile-menu__label";
    label.textContent = item.name || "Untitled";

    a.appendChild(iconSlot);
    a.appendChild(label);
    a.addEventListener("click", handleNavClick);

    return a;
}

// ── Nav click handler ────────────────────────────────────────────────────────

function handleNavClick() {
    closeMenu();
}

// ── Menu open/close ──────────────────────────────────────────────────────────

function openMenu() {
    if (!_isMobile) return;
    _menuOpen = true;
    getMenu()?.classList.add("open");
    getMenuOverlay()?.classList.add("open");
    document.body.classList.add("mobile-menu-open");
}

function closeMenu() {
    _menuOpen = false;
    getMenu()?.classList.remove("open");
    getMenuOverlay()?.classList.remove("open");
    document.body.classList.remove("mobile-menu-open");
}

function toggleMenu() {
    if (_menuOpen) closeMenu();
    else openMenu();
}

// ── Activate / deactivate mobile mode ────────────────────────────────────────

async function activateMobile() {
    if (_isMobile) return;
    _isMobile = true;
    document.body.classList.add("mobile");

    // Re-render any blog content that was already on the page (no-op on
    // first activation since rendering hasn't happened yet).
    rerenderAllBlogContent();

    buildBurger();
    buildMenuShell();

    if (!_menuBuilt) {
        await populateMenu();
        _menuBuilt = true;
    }
}

function deactivateMobile() {
    if (!_isMobile) return;
    _isMobile = false;
    closeMenu();
    document.body.classList.remove("mobile");

    // Re-render blog content back to desktop layout
    rerenderAllBlogContent();
}

// ── Resize handler ───────────────────────────────────────────────────────────

function handleResize() {
    const shouldBeMobile = checkMobile();
    if (shouldBeMobile && !_isMobile) activateMobile();
    else if (!shouldBeMobile && _isMobile) deactivateMobile();
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function init() {
    if (checkMobile()) activateMobile();

    window.addEventListener("resize", () => {
        clearTimeout(window.__mobileResizeTimer);
        window.__mobileResizeTimer = setTimeout(handleResize, 80);
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && _menuOpen) closeMenu();
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
