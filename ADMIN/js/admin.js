console.log("Admin shell loaded");

const MOBILE_BREAKPOINT = 768; // same breakpoint as public site's mobile.js

const columnsRoot   = document.getElementById("admin-columns");
const domainLogoEl  = document.getElementById("admin-domain-logo");
const domainLinkEl  = document.getElementById("admin-domain-link");
const localLogoEl   = document.getElementById("admin-local-logo");
const localLinkEl   = document.getElementById("admin-local-link");

let _isMobile   = false;
let _columnEls  = []; // in DOM order, one per column
let _menuOpen   = false;

// Inline fallback icon — same shape used across the public site (topbar.js /
// sidebar.js / logo-uploader) for missing images. Shown here whenever either
// header logo (Public Page / Local Page) fails to load — most commonly
// because this is a fresh checkout of the repo with no media/logo.png yet
// (media/ is gitignored), but also covers any other load failure.
const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

function attachLogoFallback(imgEl) {
    imgEl.addEventListener("error", () => {
        if (imgEl.src !== FALLBACK_ICON) {
            imgEl.src = FALLBACK_ICON;
            imgEl.classList.add("admin-logo--fallback");
        }
    });
}

// Wire up the fallback immediately so it applies no matter when/whether
// loadHeader() ever successfully sets a real src.
attachLogoFallback(domainLogoEl);
attachLogoFallback(localLogoEl);

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme.backgroundColor) root.style.setProperty("--admin-bg", theme.backgroundColor);
    if (theme.page?.textColor) root.style.setProperty("--admin-text", theme.page.textColor);
    if (theme.page?.fontFamily) root.style.setProperty("--admin-font", theme.page.fontFamily);
    if (theme.topbar?.backgroundColor) root.style.setProperty("--admin-panel-bg", theme.topbar.backgroundColor);
}

// Hides a logo/link pair entirely rather than leaving a broken image icon
// and a dead "#" link (which just reloads the current admin page) if its
// target couldn't be determined.
function hideHeaderLink(linkEl) {
    linkEl.style.visibility = "hidden";
}

// Sets a logo <img>'s src to a real URL, clearing any previously-applied
// fallback styling so it displays normally if this URL loads successfully.
function setLogoSrc(imgEl, src) {
    imgEl.classList.remove("admin-logo--fallback");
    imgEl.src = src;
}

async function loadHeader() {
    let config, siteInfo;
    try {
        [config, siteInfo] = await Promise.all([
            fetch("/api/config").then(r => {
                if (!r.ok) throw new Error(`/api/config returned ${r.status}`);
                return r.json();
            }),
            fetch("/api/site-info").then(r => {
                if (!r.ok) throw new Error(`/api/site-info returned ${r.status}`);
                return r.json();
            }),
        ]);
    } catch (e) {
        console.error("Admin: failed to load header/theme — check the server terminal for the actual error:", e);
        hideHeaderLink(domainLinkEl);
        hideHeaderLink(localLinkEl);
        return;
    }

    applyTheme(config.theme || {});

    const publicPort = config.hosting?.port;
    const logoRelPath = "/media/logo.png";

    if (siteInfo.siteAddress) {
        const domainBase = siteInfo.siteAddress.replace(/\/$/, "");
        domainLinkEl.href = domainBase;
        setLogoSrc(domainLogoEl, `${domainBase}${logoRelPath}`);
    } else {
        hideHeaderLink(domainLinkEl);
    }

    if (publicPort) {
        const localHost = window.location.hostname;
        const localBase = `http://${localHost}:${publicPort}`;
        localLinkEl.href = localBase;
        setLogoSrc(localLogoEl, `${localBase}${logoRelPath}`);
    } else {
        hideHeaderLink(localLinkEl);
    }
}

// Optional per-element config.json — sits next to element.html/css/js inside
// each /ADMIN/elements/<name>/ folder. Not every element has one (a plain
// 404/failed fetch just means "no config" and the element gets `null`).
// This is how a generic "edit this JSON file" element (e.g. the "master.json"
// element) learns which file it's actually pointed at (its "target") and,
// optionally, what title to display instead of that raw path (its "name")
// — all without any code changes. Copy the folder, rename it, edit its
// config.json.
async function loadElementConfig(name) {
    try {
        const res = await fetch(`/elements/${name}/config.json`);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

async function loadElementInto(panelEl, name) {
    const base = `/elements/${name}/element`;
    try {
        const html = await fetch(`${base}.html`).then(r => {
            if (!r.ok) throw new Error(`missing element.html for "${name}"`);
            return r.text();
        });
        panelEl.innerHTML = html;

        const elementConfig = await loadElementConfig(name);

        // Shared core CSS/JS — always loaded, once each.
        if (!document.querySelector('link[data-json-core-css]')) {
            const coreLink = document.createElement("link");
            coreLink.rel = "stylesheet";
            coreLink.href = "/elements/lib/css/json.css";
            coreLink.setAttribute("data-json-core-css", "1");
            document.head.appendChild(coreLink);
        }

        const { default: initJsonEditor } = await import("/elements/lib/js/json.js");
        const core = initJsonEditor(panelEl, elementConfig);

        // Optional per-element extension — element.js/element.css. Absence
        // of either is completely normal (master.json, topbar.json,
        // admin-master.json ship with neither).
        const cssHref = `${base}.css`;
        const cssCheck = await fetch(cssHref, { method: "HEAD" }).catch(() => null);
        if (cssCheck && cssCheck.ok) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = cssHref;
            document.head.appendChild(link);
        }

        const jsHref = `${base}.js`;
        const jsCheck = await fetch(jsHref, { method: "HEAD" }).catch(() => null);
        if (jsCheck && jsCheck.ok) {
            const mod = await import(jsHref);
            if (typeof mod.default === "function") {
                mod.default(panelEl, elementConfig, core);
            }
        }
    } catch (e) {
        console.error(`Admin: failed to load element "${name}":`, e);
        panelEl.innerHTML = `<p class="admin-status admin-status--error">Failed to load element "${name}": ${e.message}</p>`;
    }
}


// ── Responsive column layout ─────────────────────────────────────────────────
//
// Desktop: N columns side by side, each ~100/N% wide (inline width, set once
// after load). Mobile (≤768px, same breakpoint as the public site's
// mobile.js): a single full-width column stacking every column's panels on
// top of each other in order — handled purely with a body class + CSS so no
// DOM rebuild/element re-init is needed when the breakpoint is crossed.

function checkMobile() {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

function applyResponsiveLayout() {
    const shouldBeMobile = checkMobile();
    if (shouldBeMobile === _isMobile) return;
    _isMobile = shouldBeMobile;

    document.body.classList.toggle("admin-mobile", _isMobile);

    if (_isMobile) {
        // Let CSS (body.admin-mobile .admin-column) drive full width.
        _columnEls.forEach(el => { el.style.width = ""; });
    } else {
        const width = _columnEls.length > 0 ? `${100 / _columnEls.length}%` : "100%";
        _columnEls.forEach(el => { el.style.width = width; });
    }
}

// ── Server size badge (top-right, left of the burger) ───────────────────────

function buildServerSizeBadge() {
    const badge = document.createElement("div");
    badge.id = "adminServerSize";
    badge.className = "admin-server-size";
    badge.textContent = "…";
    badge.title = "Total size of the folder that gets backed up (./ relative to node.js)";
    document.body.appendChild(badge);

    fetch("/api/server-size")
        .then(r => r.json())
        .then((data) => {
            if (data.error) throw new Error(data.error);
            const gb = data.bytes / (1024 ** 3);
            badge.textContent = `${gb.toFixed(gb < 1 ? 2 : 1)} GB`;
        })
        .catch((e) => {
            console.error("Admin: failed to load server size:", e);
            badge.textContent = "? GB";
        });
}

// ── Slide-out panel menu (mirrors the public site's mobile hamburger menu) ──

function buildAdminMenuShell() {
    const burger = document.createElement("button");
    burger.id = "adminBurger";
    burger.className = "admin-burger";
    burger.type = "button";
    burger.setAttribute("aria-label", "Open panel menu");

    const icon = document.createElement("span");
    icon.className = "admin-burger__icon";
    for (let i = 0; i < 3; i++) {
        const bar = document.createElement("span");
        bar.className = "admin-burger__bar";
        icon.appendChild(bar);
    }
    burger.appendChild(icon);
    burger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleAdminMenu();
    });
    document.body.appendChild(burger);

    const overlay = document.createElement("div");
    overlay.id = "adminMenuOverlay";
    overlay.className = "admin-menu-overlay";
    overlay.addEventListener("click", () => closeAdminMenu());
    document.body.appendChild(overlay);

    const menu = document.createElement("aside");
    menu.id = "adminMenu";
    menu.className = "admin-menu";
    menu.setAttribute("aria-label", "Panel navigation");

    const heading = document.createElement("div");
    heading.className = "admin-menu__heading";
    heading.textContent = "Panels";
    menu.appendChild(heading);

    const list = document.createElement("div");
    list.id = "adminMenuList";
    list.className = "admin-menu__list";
    menu.appendChild(list);

    document.body.appendChild(menu);
}

function openAdminMenu() {
    _menuOpen = true;
    document.getElementById("adminMenu")?.classList.add("open");
    document.getElementById("adminMenuOverlay")?.classList.add("open");
    document.body.classList.add("admin-menu-open");
}

function closeAdminMenu() {
    _menuOpen = false;
    document.getElementById("adminMenu")?.classList.remove("open");
    document.getElementById("adminMenuOverlay")?.classList.remove("open");
    document.body.classList.remove("admin-menu-open");
}

function toggleAdminMenu() {
    if (_menuOpen) closeAdminMenu();
    else openAdminMenu();
}

// Builds the flat menu list — first column's panels, then the next
// column's, etc., matching the order panels appear in config/master.json.
// Labels use each panel's own rendered <h2> when available, falling back to
// the raw element name.
function populateAdminMenu(panelRegistry) {
    const list = document.getElementById("adminMenuList");
    if (!list) return;
    list.innerHTML = "";

    for (const { id, name } of panelRegistry) {
        const panelEl = document.getElementById(id);
        const heading = panelEl?.querySelector("h2");
        const label   = (heading?.textContent || name || "Untitled").trim();

        const item = document.createElement("button");
        item.className = "admin-menu__item";
        item.type = "button";
        item.textContent = label;
        item.addEventListener("click", () => {
            closeAdminMenu();
            const target = document.getElementById(id);
            if (target) {
                setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
            }
        });
        list.appendChild(item);
    }
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _menuOpen) closeAdminMenu();
});

// ── Column/panel building ────────────────────────────────────────────────────

async function buildColumns() {
    let layout;
    try {
        layout = await fetch("/api/layout").then(r => r.json());
    } catch (e) {
        columnsRoot.innerHTML = `<p class="admin-status admin-status--error">Failed to load admin layout: ${e.message}</p>`;
        return;
    }

    const columns = Array.isArray(layout.columns) ? layout.columns : [];

    // Recognize mobile before the very first paint of columns, so panels
    // never briefly show a squeezed multi-column layout on small screens.
    _isMobile = checkMobile();
    document.body.classList.toggle("admin-mobile", _isMobile);
    const width = (!_isMobile && columns.length > 0) ? `${100 / columns.length}%` : "";

    const panelRegistry = []; // flat, in column-then-item order — for the menu
    let panelCounter = 0;

    for (const columnNames of columns) {
        const columnEl = document.createElement("div");
        columnEl.className = "admin-column";
        columnEl.style.width = width;
        columnsRoot.appendChild(columnEl);
        _columnEls.push(columnEl);

        for (const name of columnNames) {
            const panelEl = document.createElement("section");
            panelEl.className = "admin-panel";
            panelEl.id = `admin-panel-${panelCounter++}`;
            panelEl.tabIndex = -1; // scroll target, not otherwise focusable
            columnEl.appendChild(panelEl);
            panelRegistry.push({ id: panelEl.id, name });
            await loadElementInto(panelEl, name);
        }
    }

    buildServerSizeBadge();
    buildAdminMenuShell();
    populateAdminMenu(panelRegistry);
}

// ── Resize handling ──────────────────────────────────────────────────────────

window.addEventListener("resize", () => {
    clearTimeout(window.__adminResizeTimer);
    window.__adminResizeTimer = setTimeout(applyResponsiveLayout, 80);
});

loadHeader();
buildColumns();
