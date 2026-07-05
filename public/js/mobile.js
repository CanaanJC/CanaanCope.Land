// ─────────────────────────────────────────────────────────────────────────────
// mobile.js — Mobile patch overlay
//
// Activates a mobile layout when viewport width ≤ 768px. Manages:
//   - body.mobile class toggle
//   - floating hamburger button + slide-out menu (built from topbar.json
//     and sidebar.json)
//   - relocation of page-specific dropdowns (projects.js / CrafTech.js)
//     into the menu
//   - mobile blog renderer (registered with lib-blog at module load)
//   - re-render of all blog content when the viewport mode toggles
//
// Mobile blog rendering rules:
//   - [P…] blocks: pure-media P blocks are skipped, otherwise their text
//     is split on any nested [M…] tags, with text segments rendered as
//     markdown (inline <file> / <./folder> refs stripped) and media
//     segments rendered as full-width media cells inline.
//   - [M…] blocks (top-level): rendered as full-width media.
// ─────────────────────────────────────────────────────────────────────────────

import {
    setMobileRowsBuilder,
    parseAllBlocks,
    parseMultiMediaBlock,
    isImageBlock,
    isVideoBlock,
    isAudioBlock,
    isFolderBlock,
    renderCell,
    rerenderAllBlogContent,
} from "./lib-blog.js";

console.log("Mobile module loaded");

const MOBILE_BREAKPOINT = 768;
const TOPBAR_DATA_URL   = "/json/topbar.json";
const SIDEBAR_DATA_URL  = "/json/sidebar.json";

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

const INLINE_MEDIA_REGEX = /<(\.\/[\w\-]+|[\w\-]+\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mp3|wav))>/gi;
const INNER_M_BLOCK_REGEX = /\[M([^\]]+)\]([\s\S]*?)\[\/M\1\]/g;

let _isMobile          = false;
let _menuBuilt         = false;
let _menuOpen          = false;
let _topbarObserver    = null;
let _relocatedDropdown = null;

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

// Render a single P block on mobile. The content may contain nested
// [M…]…[/M…] sub-blocks — split on those, alternating text and media
// segments, each rendered as its own full-width row.
function renderMobilePBlock(content, mediaBaseUrl, listingBaseUrl, frag) {
    const trimmed = content.trim();
    if (!trimmed) return;

    // Skip entirely if the whole block is a single pure-media payload
    // (rare on mobile since pure media should live in [M…] instead).
    if (isImageBlock(trimmed) || isVideoBlock(trimmed) ||
        isAudioBlock(trimmed)  || isFolderBlock(trimmed)) return;
    if (parseMultiMediaBlock(trimmed)) return;

    // Split content on nested [M…]…[/M…] blocks
    const segments = [];
    let lastIndex  = 0;
    // Fresh regex (don't share lastIndex across calls)
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

    // If no inner M tags, segments will be one text entry — fast path
    if (segments.length === 0) return;

    for (const seg of segments) {
        if (seg.type === "text") {
            // Strip inline <file> refs — media on mobile only comes from [M…]
            const clean = seg.value.replace(INLINE_MEDIA_REGEX, "").trim();
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
            renderMobileMediaRow(seg.value, mediaBaseUrl, listingBaseUrl, frag);
        }
    }
}

// Render a single full-width media row on mobile. Used both for top-level
// [M…] blocks and for [M…] segments extracted from inside a [P…] block.
function renderMobileMediaRow(content, mediaBaseUrl, listingBaseUrl, frag) {
    const c = content.trim();
    if (!c) return;

    const isImg = isImageBlock(c);
    const isVid = isVideoBlock(c);
    const isAud = isAudioBlock(c);
    const isDir = isFolderBlock(c);

    const row = document.createElement("div");
    row.className = "blog-row blog-row--full";

    const cell = renderCell(c, mediaBaseUrl, listingBaseUrl, isImg, isVid, isAud, isDir);
    if (isImg || isVid || isDir) cell.classList.add("blog-cell--image-left");

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

function getBurger()          { return document.getElementById("mobileBurger"); }
function getMenu()            { return document.getElementById("mobileMenu"); }
function getMenuOverlay()     { return document.getElementById("mobileMenuOverlay"); }
function getProjectsSlot()    { return document.getElementById("mobileMenuProjectsSlot"); }
function getSidebarSlot()     { return document.getElementById("mobileMenuSidebarSlot"); }
function getDropdownSlot()    { return document.getElementById("mobileMenuPageDropdownSlot"); }
function getDropdownDivider() { return document.getElementById("mobileMenuDropdownDivider"); }

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
    logoImg.src = FALLBACK_ICON;
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

    const div2 = document.createElement("hr");
    div2.className = "mobile-menu__divider";
    div2.id = "mobileMenuDropdownDivider";
    div2.style.display = "none";
    menu.appendChild(div2);

    const dropdownSlot = document.createElement("div");
    dropdownSlot.id = "mobileMenuPageDropdownSlot";
    dropdownSlot.className = "mobile-menu__page-dropdown-slot";
    menu.appendChild(dropdownSlot);

    document.body.appendChild(menu);
}

// ── Populate menu from JSON ──────────────────────────────────────────────────

async function populateMenu() {
    try {
        const res = await fetch(`${TOPBAR_DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
            const data = await res.json();
            if (data.logo) {
                const img = document.querySelector("#mobileMenuLogo .mobile-menu__logo-img");
                if (img) img.src = data.logo;
            }
            const projectsSlot = getProjectsSlot();
            if (projectsSlot && Array.isArray(data.dropdowns)) {
                projectsSlot.innerHTML = "";
                for (const dropdown of data.dropdowns) {
                    if (!Array.isArray(dropdown.items)) continue;
                    for (const item of dropdown.items) {
                        projectsSlot.appendChild(buildMenuLink(item));
                    }
                }
            }
        }
    } catch (err) {
        console.error("Mobile: failed to load topbar.json:", err);
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

// ── Slogan: collapse runs of spaces into single spaces on mobile ─────────────

function fixSloganSpacing() {
    if (!_isMobile) return;
    const slogan = document.querySelector(".topbar-slogan");
    if (!slogan) return;
    const text = slogan.textContent.replace(/\s+/g, " ").trim();
    if (slogan.textContent !== text) slogan.textContent = text;
}

// ── Topbar dropdown relocator ────────────────────────────────────────────────

function relocateDropdownIfPresent() {
    if (!_isMobile) return;
    const topbar = document.getElementById("topbarList");
    const slot   = getDropdownSlot();
    if (!topbar || !slot) return;

    const dropdown = topbar.querySelector(".topbar-dropdown");
    if (!dropdown) return;
    if (dropdown === _relocatedDropdown && dropdown.parentNode === slot) return;

    slot.innerHTML = "";
    slot.appendChild(dropdown);
    _relocatedDropdown = dropdown;

    const divider = getDropdownDivider();
    if (divider) divider.style.display = "";

    rewireDropdownForTouch(dropdown);

    dropdown.querySelectorAll(".topbar-dropdown__item").forEach(item => {
        if (item.__mobileWired) return;
        item.__mobileWired = true;
        item.addEventListener("click", () => setTimeout(() => closeMenu(), 0));
    });
}

function rewireDropdownForTouch(dropdown) {
    if (dropdown.__mobileTouchWired) return;
    dropdown.__mobileTouchWired = true;

    const trigger = dropdown.querySelector(".topbar-dropdown__trigger");
    if (!trigger) return;

    trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropdown.classList.toggle("open");
    });
}

function restoreDropdown() {
    if (!_relocatedDropdown) return;
    const topbar = document.getElementById("topbarList");
    if (!topbar) return;

    const logo = topbar.querySelector(".topbar-logo");
    if (logo && logo.nextSibling) topbar.insertBefore(_relocatedDropdown, logo.nextSibling);
    else topbar.appendChild(_relocatedDropdown);

    const divider = getDropdownDivider();
    if (divider) divider.style.display = "none";

    _relocatedDropdown = null;
}

// ── Topbar observer ──────────────────────────────────────────────────────────

function startTopbarObserver() {
    if (_topbarObserver) return;
    const topbar = document.getElementById("topbarList");
    if (!topbar) return;

    _topbarObserver = new MutationObserver(() => {
        relocateDropdownIfPresent();
        fixSloganSpacing();
    });
    _topbarObserver.observe(topbar, { childList: true, subtree: false });
}

function stopTopbarObserver() {
    if (!_topbarObserver) return;
    _topbarObserver.disconnect();
    _topbarObserver = null;
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

    startTopbarObserver();
    relocateDropdownIfPresent();
    fixSloganSpacing();

    if (!_menuBuilt) {
        await populateMenu();
        _menuBuilt = true;
    }

    relocateDropdownIfPresent();
    fixSloganSpacing();
}

function deactivateMobile() {
    if (!_isMobile) return;
    _isMobile = false;
    closeMenu();
    document.body.classList.remove("mobile");

    // Re-render blog content back to desktop layout
    rerenderAllBlogContent();

    stopTopbarObserver();
    restoreDropdown();
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
