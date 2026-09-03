import {
    loadMarked,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

import {
    entryId,
    sortManifestEntries,
    buildNavItems,
    navTriggerLabel,
    folderLabel,
} from "./lib-nav.js";

console.log("Library module loaded");

const PRELOAD_AHEAD = 2;

const _pathParts   = window.location.pathname.split("/").filter(Boolean);
const IS_BLOCKED   = !!window.__LIBRARY_BLOCKED_PATH__;

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

function applyLibraryTitle(library) {
    if (!library) return;
    document.title = library.name || library.path || document.title;
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

/* --- Dividers --------------------------------------------------------------
   A plain divider is the usual line. A "folder" divider is used when two
   consecutive blogs live in different folders (at ANY depth): it's the same
   line, but broken in the middle with the folder title sitting in the gap. */
function buildPlainDivider() {
    const hr = document.createElement("hr");
    hr.className = "blog-divider";
    return hr;
}

function buildFolderDivider(title) {
    const div = document.createElement("div");
    div.className = "blog-divider blog-divider--labeled";
    div.setAttribute("role", "separator");

    const label = document.createElement("span");
    label.className = "blog-divider__label";
    label.textContent = title;
    div.appendChild(label);

    return div;
}

// If prev and cur blogs share the same parent folder path, returns null (plain
// divider). Otherwise returns the label of the FIRST folder level at which they
// diverge — i.e. the title of the folder boundary being crossed.
function folderDividerLabel(prev, cur) {
    const a = Array.isArray(prev.slugPath) ? prev.slugPath : [];
    const b = Array.isArray(cur.slugPath)  ? cur.slugPath  : [];
    const parentLen = b.length - 1; // exclude the blog folder itself

    for (let i = 0; i < parentLen; i++) {
        if (a[i] !== b[i]) return folderLabel(b[i]);
    }
    return null;
}

function appendDivider(container, prevEntry, curEntry) {
    const label = prevEntry ? folderDividerLabel(prevEntry, curEntry) : null;
    container.appendChild(label ? buildFolderDivider(label) : buildPlainDivider());
}

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

function buildTopbarNav(library, sortedManifest) {
    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "library-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = navTriggerLabel(library);
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const item of buildNavItems(library, sortedManifest)) {
        const btn = document.createElement("button");
        btn.className = `topbar-dropdown__item topbar-tree-item ${item.isLeaf ? "topbar-tree-item--leaf" : "topbar-tree-item--group"}`;
        btn.dataset.level = String(item.level);
        btn.textContent = item.label;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.remove("open");
            scrollToId(item.targetId);
        });
        menu.appendChild(btn);
    }

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

async function injectNav(library, sortedManifest) {
    if (!sortedManifest.length) return;
    const topbar = await waitForTopbarReady();
    if (!topbar) return;

    const existing = topbar.querySelector("#library-nav-dropdown");
    if (existing) existing.remove();

    const nav = buildTopbarNav(library, sortedManifest);

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

    manifest = sortManifestEntries(library, manifest);
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
            appendDivider(container, manifest[i - 1], entry);
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
