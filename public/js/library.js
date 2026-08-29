import {
    loadMarked,
    getEndDate,
    sortByEndDate,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

console.log("Library module loaded");

const PRELOAD_AHEAD = 2;

// ── Guard ─────────────────────────────────────────────────────────────────────

const _pathParts   = window.location.pathname.split("/").filter(Boolean);
const IS_BLOCKED   = !!window.__LIBRARY_BLOCKED_PATH__;

// ── Libraries config ──────────────────────────────────────────────────────────

let _librariesCache = null;

async function fetchLibraries() {
    if (_librariesCache) return _librariesCache;
    try {
        const res = await fetch(`/config/libraries.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`libraries.json HTTP ${res.status}`);
        _librariesCache = await res.json();
    } catch (err) {
        console.error("Library: failed to load libraries.json:", err);
        _librariesCache = [];
    }
    return _librariesCache;
}

async function resolveLibrary() {
    const libraries = await fetchLibraries();
    if (IS_BLOCKED) {
        return libraries.find(l => l.path === window.__LIBRARY_BLOCKED_PATH__) || null;
    }
    return libraries.find(l => l.path === _pathParts[0]) || null;
}

// ── Page title injection ──────────────────────────────────────────────────────
//
// Every library page's static index.html ships with a placeholder
// <title>Library</title>. As soon as the library is resolved, overwrite the
// browser tab title with that library's own name (falling back to its path
// if `name` is empty) — no per-library HTML edits needed, this covers every
// library index.html (and the blocked/embed shell) automatically.
function applyLibraryTitle(library) {
    if (!library) return;
    document.title = library.name || library.path || document.title;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

function entryId(slugPath) {
    return slugPath.join("--");
}

async function fetchEntryFiles(library, slugPath) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    const [configRes, mdRes] = await Promise.all([
        fetch(`${base}/config.json?_=${Date.now()}`,  { cache: "no-store" }),
        fetch(`${base}/content.md?_=${Date.now()}`,   { cache: "no-store" }),
    ]);
    if (!configRes.ok || !mdRes.ok) throw new Error(`Failed to load ${base}`);
    const config = await configRes.json();
    const rawMd  = await mdRes.text();
    return { config, rawMd };
}

function buildEntryBlock(library, slugPath, config, rawMd) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    return buildProjectBlock({
        elementId:      entryId(slugPath),
        title:          config.name || slugPath[slugPath.length - 1],
        date:           config.date || null,
        rawMd,
        mediaBaseUrl:   `${base}/media`,
        listingBaseUrl: `${base}/media-listing`,
    });
}

// ── Wait for topbar ───────────────────────────────────────────────────────────
//
// Waits for topbar.js's explicit "topbar:ready" signal (dispatched only once
// the Projects/libraries dropdown is actually in the DOM), rather than the
// old "topbar has some children" heuristic. That heuristic raced with
// topbar.js's own async build sequence — depending on which fetch won,
// injectNav() below could run before, during, or after topbar.js finished,
// causing the Projects dropdown and this library's own By Month/Contents
// dropdown to appear inconsistently (sometimes both, sometimes only one).
// A safety-net timeout still resolves this after maxMs in case topbar.js
// ever fails to fire the event at all, so this never hangs forever.
function waitForTopbarReady(maxMs = 4000) {
    const topbarEl = document.getElementById("topbarList");
    if (!topbarEl) return Promise.resolve(null);
    if (window.__TOPBAR_READY__) return Promise.resolve(topbarEl);
    return new Promise(resolve => {
        const done = () => resolve(topbarEl);
        document.addEventListener("topbar:ready", done, { once: true });
        setTimeout(done, maxMs);
    });
}

function scrollToId(id, behavior = "smooth") {
    if (!id) return;
    const el = document.getElementById(id) || document.getElementById(`placeholder-${id}`);
    if (el) el.scrollIntoView({ behavior, block: "start" });
}

// ── Date-mode nav (Year → Month), works for any depth but built off .date ────

function buildTopbarDateNav(sortedManifest) {
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

    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "library-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = "By Month";
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const year of years) {
        const yearBtn = document.createElement("button");
        yearBtn.className = "topbar-dropdown__item topbar-tree-item topbar-tree-item--group";
        yearBtn.dataset.level = "0";
        yearBtn.textContent = year;
        yearBtn.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.remove("open");
            scrollToId(yearToId.get(year));
        });
        menu.appendChild(yearBtn);

        const months = [...yearMonths.get(year)].sort((a, b) => Number(b) - Number(a));
        for (const month of months) {
            const monthBtn = document.createElement("button");
            monthBtn.className = "topbar-dropdown__item topbar-tree-item topbar-tree-item--leaf";
            monthBtn.dataset.level = "1";
            monthBtn.textContent = month;
            monthBtn.addEventListener("click", (e) => {
                e.preventDefault();
                wrapper.classList.remove("open");
                scrollToId(monthToId.get(`${year}/${month}`));
            });
            menu.appendChild(monthBtn);
        }
    }

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

// ── Title-mode nav (recursive N-level tree from folder segments) ────────────

function buildTree(manifest) {
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

function renderTreeNodes(node, depth, container, closeMenu) {
    const children = [...node.children.values()]
        .sort((a, b) => a.num - b.num || a.title.localeCompare(b.title));

    for (const child of children) {
        const isLeaf = child.children.size === 0;

        const btn = document.createElement("button");
        btn.className = `topbar-dropdown__item topbar-tree-item ${isLeaf ? "topbar-tree-item--leaf" : "topbar-tree-item--group"}`;
        btn.dataset.level = String(depth);
        btn.textContent = child.title;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            closeMenu();
            const targetSlugPath = isLeaf ? child.entry.slugPath : firstLeafSlugPath(child);
            scrollToId(entryId(targetSlugPath));
        });
        container.appendChild(btn);

        if (!isLeaf) renderTreeNodes(child, depth + 1, container, closeMenu);
    }
}

function buildTopbarTreeNav(sortedManifest) {
    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "library-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = "Contents";
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    const tree = buildTree(sortedManifest);
    renderTreeNodes(tree, 0, menu, () => wrapper.classList.remove("open"));

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

// Injects this library's own nav dropdown (By Month / Contents) into the
// topbar, always positioned immediately after the Projects/libraries
// dropdown (#libraries-nav-dropdown) — never replacing or removing it.
// Only this function's own #library-nav-dropdown is ever removed/rebuilt
// here, so the Projects dropdown is guaranteed to always remain visible
// alongside it, in a fixed, deterministic order: Projects → By Month/Contents.
async function injectNav(library, sortedManifest) {
    if (!sortedManifest.length) return;
    const topbar = await waitForTopbarReady();
    if (!topbar) return;

    const existing = topbar.querySelector("#library-nav-dropdown");
    if (existing) existing.remove();

    const nav = library.useDates ? buildTopbarDateNav(sortedManifest) : buildTopbarTreeNav(sortedManifest);

    const librariesDropdown = topbar.querySelector("#libraries-nav-dropdown");
    const logo = topbar.querySelector(".topbar-logo");

    if (librariesDropdown && librariesDropdown.nextSibling) {
        topbar.insertBefore(nav, librariesDropdown.nextSibling);
    } else if (librariesDropdown) {
        topbar.appendChild(nav);
    } else if (logo && logo.nextSibling) {
        topbar.insertBefore(nav, logo.nextSibling);
    } else {
        topbar.appendChild(nav);
    }
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortManifest(library, manifest) {
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

// ── Scroll tracking ───────────────────────────────────────────────────────────

function setupScrollTracking(library, slugPaths) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const id       = entry.target.id;
                    const slugPath = id.split("--");
                    const newUrl   = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
                    if (window.location.pathname !== newUrl) {
                        history.replaceState(null, "", newUrl);
                    }
                }
            }
        },
        { rootMargin: "0px 0px -80% 0px", threshold: 0 }
    );
    for (const slugPath of slugPaths) {
        const el = document.getElementById(entryId(slugPath));
        if (el) observer.observe(el);
    }
}

// ── Lazy load callback ────────────────────────────────────────────────────────

function makeEntryLoader(library) {
    return async function loadEntryById(id) {
        const slugPath = id.split("--");
        try {
            const { config, rawMd } = await fetchEntryFiles(library, slugPath);
            const dom = buildEntryBlock(library, slugPath, config, rawMd);
            setupScrollTracking(library, [slugPath]);
            return dom;
        } catch (err) {
            console.error(`Library: failed to load "${library.path}/${slugPath.join("/")}":`, err);
            return null;
        }
    };
}

// ── Blocked entry mode ────────────────────────────────────────────────────────

async function loadBlockedEntry(library) {
    const slugPath   = window.__LIBRARY_BLOCKED_SLUG__;
    const container  = document.getElementById("projects-container");
    if (!container || !slugPath) return;
    await loadMarked();
    try {
        const { config, rawMd } = await fetchEntryFiles(library, slugPath);
        container.appendChild(buildEntryBlock(library, slugPath, config, rawMd));
    } catch (err) {
        console.error(`Library: failed to load blocked entry "${library.path}/${slugPath.join("/")}":`, err);
    }
}

// ── Normal mode ───────────────────────────────────────────────────────────────

async function loadLibrary(library) {
    const container = document.getElementById("projects-container");
    if (!container) return;

    await loadMarked();

    let manifest;
    try {
        const res = await fetch(`/${library.path}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        manifest = await res.json();
    } catch (err) {
        console.error(`Library: failed to load manifest for "${library.path}":`, err);
        return;
    }

    if (!manifest.length) {
        container.innerHTML = `<p style="color:var(--muted);padding:48px;">No entries yet.</p>`;
        return;
    }

    manifest = sortManifest(library, manifest);
    injectNav(library, manifest);

    const targetId = (() => {
        const hash = window.location.hash.replace("#", "");
        if (hash) return hash;
        if (_pathParts.length >= 1 + library.depth) {
            return _pathParts.slice(1, 1 + library.depth).join("--");
        }
        return null;
    })();

    const targetIndex = targetId
        ? Math.max(manifest.findIndex(e => entryId(e.slugPath) === targetId), 0)
        : 0;

    const eagerCutoff = targetIndex + PRELOAD_AHEAD;
    const eagerList   = manifest.slice(0, eagerCutoff + 1);
    const lazyList    = manifest.slice(eagerCutoff + 1);

    const eagerResults = await Promise.all(
        eagerList.map(async entry => {
            const id = entryId(entry.slugPath);
            try {
                const { config, rawMd } = await fetchEntryFiles(library, entry.slugPath);
                return { id, dom: buildEntryBlock(library, entry.slugPath, config, rawMd) };
            } catch {
                console.error(`Library: eager load failed for "${library.path}/${entry.slugPath.join("/")}"`);
                return { id, dom: createPlaceholder(id) };
            }
        })
    );

    for (let i = 0; i < manifest.length; i++) {
        const entry = manifest[i];
        const id    = entryId(entry.slugPath);

        if (i > 0) {
            const hr = document.createElement("hr");
            hr.className = "blog-divider";
            container.appendChild(hr);
        }

        const eager = eagerResults.find(r => r.id === id);
        container.appendChild(eager ? eager.dom : createPlaceholder(id));
    }

    if (targetId) {
        const target = document.getElementById(targetId);
        if (target) setTimeout(() => target.scrollIntoView({ behavior: "instant", block: "start" }), 50);
    }

    setupScrollTracking(library, eagerList.map(e => e.slugPath));

    if (lazyList.length > 0) {
        const lazyIds = lazyList.map(e => entryId(e.slugPath));
        setupLazyLoading(lazyIds, makeEntryLoader(library), PRELOAD_AHEAD);
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
    const library = await resolveLibrary();
    if (!library) {
        console.error("Library: could not resolve a library for this page.");
        return;
    }
    applyLibraryTitle(library);
    if (IS_BLOCKED) loadBlockedEntry(library);
    else loadLibrary(library);
});
