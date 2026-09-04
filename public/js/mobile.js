import {
    setMobileRowsBuilder,
    parseAllBlocks,
    isMediaOnlyBlock,
    extractInlineSegments,
    renderMediaToken,
    renderCell,
    rerenderAllBlogContent,
} from "./lib-blog.js";

import {
    sortManifestEntries,
    buildNavItems,
} from "./lib-nav.js";

const MOBILE_BREAKPOINT   = 768;
const LIBRARIES_DATA_URL  = "/config/libraries.json";
const SIDEBAR_DATA_URL    = "/json/sidebar.json";
const TOPBAR_DATA_URL     = "/json/topbar.json";
const THEME_DATA_URL      = "/config/theme.json";

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

function renderMobilePBlock(content, mediaBaseUrl, listingBaseUrl, frag) {
    const trimmed = content.trim();
    if (!trimmed) return;

    if (isMediaOnlyBlock(trimmed)) return;

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

setMobileRowsBuilder(buildMobileRows);

function checkMobile() {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function getBurger()       { return document.getElementById("mobileBurger"); }
function getMenu()         { return document.getElementById("mobileMenu"); }
function getMenuOverlay()  { return document.getElementById("mobileMenuOverlay"); }
function getProjectsSlot() { return document.getElementById("mobileMenuProjectsSlot"); }
function getSidebarSlot()  { return document.getElementById("mobileMenuSidebarSlot"); }
function getLogoImg()      { return document.getElementById("mobileMenuLogoImg"); }

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
    logoImg.id = "mobileMenuLogoImg";
    logoImg.className = "mobile-menu__logo-img";
    logoImg.alt = "Site logo";
    logoImg.src = FALLBACK_ICON;
    logoImg.addEventListener("error", () => {
        logoImg.src = FALLBACK_ICON;
        logoImg.classList.add("fallback");
    });
    logoLink.appendChild(logoImg);
    menu.appendChild(logoLink);

    const projectsSlot = document.createElement("div");
    projectsSlot.id = "mobileMenuProjectsSlot";
    menu.appendChild(projectsSlot);

    const sidebarSlot = document.createElement("div");
    sidebarSlot.id = "mobileMenuSidebarSlot";
    menu.appendChild(sidebarSlot);

    document.body.appendChild(menu);
}

function scrollToMobileId(id) {
    closeMenu();
    setTimeout(() => {
        if (!id) return;
        const el = document.getElementById(id) || document.getElementById(`placeholder-${id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 260);
}

function navigateOrScrollMobile(library, targetId) {
    if (!targetId) {
        closeMenu();
        return;
    }

    const onThisLibrary = window.__CURRENT_LIBRARY_PATH__ === library.path;

    if (onThisLibrary) {
        scrollToMobileId(targetId);
        return;
    }

    closeMenu();
    window.location.href = `/${library.path}#${targetId}`;
}

function renderMobileNavItems(items, container, library) {
    for (const item of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `mobile-menu__item topbar-tree-item ${item.isLeaf ? "topbar-tree-item--leaf" : "topbar-tree-item--group"}`;
        btn.dataset.level = String(item.level);
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            navigateOrScrollMobile(library, item.targetId);
        });
        container.appendChild(btn);
    }
}

function getCurrentLibrary(libraries) {
    if (window.__CURRENT_LIBRARY_PATH__) {
        return libraries.find(l => l.path === window.__CURRENT_LIBRARY_PATH__) || null;
    }
    const blockedPath = window.__LIBRARY_BLOCKED_PATH__;
    if (blockedPath) return libraries.find(l => l.path === blockedPath) || null;
    return null;
}

async function fetchJson(url) {
    try {
        const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
        return res.ok ? await res.json() : null;
    } catch (err) {
        console.error(`Mobile: failed to load ${url}:`, err);
        return null;
    }
}

async function populateLibraryTree(container, library) {
    try {
        const res = await fetch(`/${library.path}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        let manifest = await res.json();
        if (!Array.isArray(manifest) || manifest.length === 0) return;

        manifest = sortManifestEntries(library, manifest);
        renderMobileNavItems(buildNavItems(library, manifest), container, library);
    } catch (err) {
        console.error(`Mobile: failed to load manifest for "${library.path}":`, err);
    }
}

function buildSectionTitleIcon() {
    const icon = document.createElement("span");
    icon.className = "mobile-menu__section-title-icon";
    for (let i = 0; i < 3; i++) {
        const bar = document.createElement("span");
        bar.className = "mobile-menu__section-title-bar";
        icon.appendChild(bar);
    }
    return icon;
}

async function buildContentsView(library, librariesTitle, libraryListView) {
    const contentsView = document.createElement("div");
    contentsView.className = "mobile-menu__contents-view";

    const title = document.createElement("button");
    title.type = "button";
    title.className = "mobile-menu__section-title";
    title.appendChild(buildSectionTitleIcon());

    const label = document.createElement("span");
    label.className = "mobile-menu__section-title-label";
    label.textContent = librariesTitle;
    title.appendChild(label);

    title.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        contentsView.hidden = true;
        libraryListView.hidden = false;
    });
    contentsView.appendChild(title);

    const tree = document.createElement("div");
    tree.className = "mobile-menu__tree";
    await populateLibraryTree(tree, library);
    contentsView.appendChild(tree);

    return contentsView;
}

function buildLibraryListView(visibleLibraries, librariesTitle, projectsSlot) {
    const view = document.createElement("div");
    view.className = "mobile-menu__library-list";

    for (const lib of visibleLibraries) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "mobile-menu__item";

        const iconSlot = document.createElement("span");
        iconSlot.className = "mobile-menu__icon-slot";
        if (lib.icon && typeof lib.icon === "string" && lib.icon.trim() !== "") {
            const img = document.createElement("img");
            img.className = "mobile-menu__icon";
            img.alt = lib.name || "";
            img.src = lib.icon;
            img.addEventListener("error", () => {
                img.src = FALLBACK_ICON;
                img.classList.add("fallback");
            });
            iconSlot.appendChild(img);
        }

        const label = document.createElement("span");
        label.className = "mobile-menu__label mobile-menu__label--library";
        label.textContent = lib.name || lib.path;

        item.appendChild(iconSlot);
        item.appendChild(label);

        item.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();

            let contentsView = projectsSlot.querySelector(".mobile-menu__contents-view");
            if (contentsView) contentsView.remove();

            contentsView = await buildContentsView(lib, librariesTitle, view);
            projectsSlot.insertBefore(contentsView, view);

            view.hidden = true;
            contentsView.hidden = false;
        });

        view.appendChild(item);
    }

    return view;
}

async function populateMenu() {
    const projectsSlot = getProjectsSlot();

    const [libraries, topbarData, themeData] = await Promise.all([
        fetchJson(LIBRARIES_DATA_URL),
        fetchJson(TOPBAR_DATA_URL),
        fetchJson(THEME_DATA_URL),
    ]);

    const logoImg = getLogoImg();
    if (logoImg) {
        const iconUrl = themeData && themeData.theme && themeData.theme.topbar && themeData.theme.topbar.icon;
        logoImg.src = iconUrl || FALLBACK_ICON;
    }

    const librariesTitle = (topbarData && topbarData.librariesDropdownTitle) || "Projects";

    if (projectsSlot && Array.isArray(libraries)) {
        projectsSlot.innerHTML = "";

        const visibleLibraries = libraries.filter(lib => lib && !lib.hidden && lib.path);
        const currentLibrary   = getCurrentLibrary(libraries);
        const libraryListView  = buildLibraryListView(visibleLibraries, librariesTitle, projectsSlot);

        if (currentLibrary) {
            const contentsView = await buildContentsView(currentLibrary, librariesTitle, libraryListView);
            libraryListView.hidden = true;
            projectsSlot.appendChild(contentsView);
            projectsSlot.appendChild(libraryListView);
        } else {
            projectsSlot.appendChild(libraryListView);
        }
    }

    const sidebarData = await fetchJson(SIDEBAR_DATA_URL);
    const sidebarSlot = getSidebarSlot();
    if (sidebarSlot && Array.isArray(sidebarData)) {
        sidebarSlot.innerHTML = "";
        for (const item of sidebarData) {
            if (!item || !item.link) continue;
            sidebarSlot.appendChild(buildMenuLink({
                name: item.text,
                link: item.link,
                icon: item.image,
            }));
        }
    }
}

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

    return a;
}

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

async function activateMobile() {
    if (_isMobile) return;
    _isMobile = true;
    document.body.classList.add("mobile");

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

    rerenderAllBlogContent();
}

function handleResize() {
    const shouldBeMobile = checkMobile();
    if (shouldBeMobile && !_isMobile) activateMobile();
    else if (!shouldBeMobile && _isMobile) deactivateMobile();
}

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
