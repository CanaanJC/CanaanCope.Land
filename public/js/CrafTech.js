import {
    loadMarked,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

console.log("CrafTech module loaded");

const PRELOAD_AHEAD = 2;

// ── Guard ─────────────────────────────────────────────────────────────────────

const _pathname      = window.location.pathname.replace(/\/$/, "");
const _pathParts     = _pathname.split("/").filter(Boolean);
const IS_CRAFTECH    = _pathParts[0] === "CrafTech";
const IS_BLOCKED     = !!window.__CRAFTECH_BLOCKED_MAJOR__;

if (!IS_CRAFTECH && !IS_BLOCKED) {
    throw new Error("[CrafTech.js] Not a CrafTech page, halting module.");
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchProjectFiles(majorSlug, subSlug) {
    const [configRes, mdRes] = await Promise.all([
        fetch(`/CrafTech/${majorSlug}/${subSlug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/CrafTech/${majorSlug}/${subSlug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
    ]);
    if (!configRes.ok || !mdRes.ok) throw new Error(`Failed to load CrafTech/${majorSlug}/${subSlug}`);
    const config = await configRes.json();
    const rawMd  = await mdRes.text();
    return { config, rawMd };
}

function buildBlock(majorSlug, subSlug, config, rawMd) {
    return buildProjectBlock({
        elementId:      `${majorSlug}--${subSlug}`,
        title:          config.name || subSlug,
        date:           null,
        rawMd,
        mediaBaseUrl:   `/CrafTech/${majorSlug}/${subSlug}/media`,
        listingBaseUrl: `/CrafTech/${majorSlug}/${subSlug}/media-listing`,
    });
}

// ── Sorting ───────────────────────────────────────────────────────────────────

function sortByFolderNumber(manifest) {
    return [...manifest].sort((a, b) => {
        if (a.majorNum !== b.majorNum) return a.majorNum - b.majorNum;
        return a.subNum - b.subNum;
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

// ── Scroll to element ─────────────────────────────────────────────────────────

function scrollToId(id, behavior = "smooth") {
    const el = document.getElementById(id) || document.getElementById(`placeholder-${id}`);
    if (el) el.scrollIntoView({ behavior, block: "start" });
}

// ── Topbar folder nav ─────────────────────────────────────────────────────────

function buildTopbarFolderNav(sortedManifest) {
    // Group by major section
    const majorMap = new Map();
    for (const entry of sortedManifest) {
        if (!majorMap.has(entry.majorSlug)) {
            majorMap.set(entry.majorSlug, {
                name:    entry.majorName,
                entries: [],
            });
        }
        majorMap.get(entry.majorSlug).entries.push(entry);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "craftech-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = "Contents";
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const [majorSlug, section] of majorMap) {
        // Major heading (reuses year styling)
        const majorBtn = document.createElement("button");
        majorBtn.className = "topbar-dropdown__item topbar-month-nav--year";
        majorBtn.textContent = section.name;
        majorBtn.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.remove("open");
            // Scroll to first entry in this major section
            if (section.entries.length > 0) {
                const first = section.entries[0];
                scrollToId(`${first.majorSlug}--${first.subSlug}`);
            }
        });
        menu.appendChild(majorBtn);

        // Sub-entries (reuses month styling)
        for (const entry of section.entries) {
            const subBtn = document.createElement("button");
            subBtn.className = "topbar-dropdown__item topbar-month-nav--month";
            subBtn.textContent = entry.name;
            subBtn.addEventListener("click", (e) => {
                e.preventDefault();
                wrapper.classList.remove("open");
                scrollToId(`${entry.majorSlug}--${entry.subSlug}`);
            });
            menu.appendChild(subBtn);
        }
    }

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

async function injectTopbarFolderNav(sortedManifest) {
    if (!sortedManifest.length) return;
    const topbar = await waitForTopbar();
    if (!topbar) return;
    // Remove any existing dropdowns injected by topbar.js or previous calls
    for (const el of [...topbar.querySelectorAll(".topbar-dropdown")]) el.remove();
    const logo = topbar.querySelector(".topbar-logo");
    const nav  = buildTopbarFolderNav(sortedManifest);
    if (logo && logo.nextSibling) topbar.insertBefore(nav, logo.nextSibling);
    else topbar.appendChild(nav);
}

// ── Scroll tracking ───────────────────────────────────────────────────────────

function setupScrollTracking(ids) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const id       = entry.target.id;
                    const parts    = id.split("--");
                    if (parts.length < 2) continue;
                    const newUrl = `/CrafTech/${parts[0]}/${parts[1]}`;
                    if (window.location.pathname !== newUrl) {
                        history.replaceState(null, "", newUrl);
                    }
                }
            }
        },
        { rootMargin: "0px 0px -80% 0px", threshold: 0 }
    );
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
    }
}

// ── Lazy load callback ────────────────────────────────────────────────────────

async function loadEntryById(elementId) {
    // elementId format: "majorSlug--subSlug"
    const parts = elementId.split("--");
    if (parts.length < 2) return null;
    const majorSlug = parts[0];
    const subSlug   = parts[1];
    try {
        const { config, rawMd } = await fetchProjectFiles(majorSlug, subSlug);
        const dom = buildBlock(majorSlug, subSlug, config, rawMd);
        setupScrollTracking([elementId]);
        return dom;
    } catch (err) {
        console.error(`CrafTech: failed to load "${majorSlug}/${subSlug}":`, err);
        return null;
    }
}

// ── Blocked entry mode ────────────────────────────────────────────────────────

async function loadBlockedEntry() {
    const majorSlug = window.__CRAFTECH_BLOCKED_MAJOR__;
    const subSlug   = window.__CRAFTECH_BLOCKED_SUB__;
    const container = document.getElementById("projects-container");
    if (!container) return;
    await loadMarked();
    try {
        const { config, rawMd } = await fetchProjectFiles(majorSlug, subSlug);
        container.appendChild(buildBlock(majorSlug, subSlug, config, rawMd));
    } catch (err) {
        console.error(`CrafTech: failed to load blocked entry "${majorSlug}/${subSlug}":`, err);
    }
}

// ── Normal mode ───────────────────────────────────────────────────────────────

async function loadCrafTech() {
    const container = document.getElementById("projects-container");
    if (!container) return;

    await loadMarked();

    let manifest;
    try {
        const res = await fetch(`/CrafTech/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`CrafTech manifest HTTP ${res.status}`);
        manifest = await res.json();
    } catch (err) {
        console.error("CrafTech: failed to load manifest:", err);
        return;
    }

    if (!manifest.length) {
        container.innerHTML = `<p style="color:var(--muted);padding:48px;">No entries yet.</p>`;
        return;
    }

    manifest = sortByFolderNumber(manifest);
    injectTopbarFolderNav(manifest);

    // Resolve scroll target from hash or direct path
    const targetId = (() => {
        const hash = window.location.hash.replace("#", "");
        if (hash) return hash; // format: "majorSlug--subSlug"
        // Handle direct path like /CrafTech/00-about/00-intro after scroll tracking
        if (_pathParts.length >= 3) return `${_pathParts[1]}--${_pathParts[2]}`;
        return null;
    })();

    const targetIndex = targetId
        ? Math.max(manifest.findIndex(e => `${e.majorSlug}--${e.subSlug}` === targetId), 0)
        : 0;

    const eagerCutoff = targetIndex + PRELOAD_AHEAD;
    const eagerList   = manifest.slice(0, eagerCutoff + 1);
    const lazyList    = manifest.slice(eagerCutoff + 1);

    // Eager fetch
    const eagerResults = await Promise.all(
        eagerList.map(async entry => {
            const id = `${entry.majorSlug}--${entry.subSlug}`;
            try {
                const { config, rawMd } = await fetchProjectFiles(entry.majorSlug, entry.subSlug);
                return { id, dom: buildBlock(entry.majorSlug, entry.subSlug, config, rawMd) };
            } catch {
                console.error(`CrafTech: eager load failed for "${entry.majorSlug}/${entry.subSlug}"`);
                return { id, dom: createPlaceholder(id) };
            }
        })
    );

    // Insert all entries in order
    for (let i = 0; i < manifest.length; i++) {
        const entry = manifest[i];
        const id    = `${entry.majorSlug}--${entry.subSlug}`;

        if (i > 0) {
            const hr = document.createElement("hr");
            hr.className = "blog-divider";
            container.appendChild(hr);
        }

        const eager = eagerResults.find(r => r.id === id);
        container.appendChild(eager ? eager.dom : createPlaceholder(id));
    }

    // Scroll to target
    if (targetId) {
        const target = document.getElementById(targetId);
        if (target) setTimeout(() => target.scrollIntoView({ behavior: "instant", block: "start" }), 50);
    }

    // Scroll tracking for eager entries
    setupScrollTracking(eagerList.map(e => `${e.majorSlug}--${e.subSlug}`));

    // Lazy load remaining
    if (lazyList.length > 0) {
        const lazyIds = lazyList.map(e => `${e.majorSlug}--${e.subSlug}`);
        setupLazyLoading(lazyIds, loadEntryById, PRELOAD_AHEAD);
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    if (IS_BLOCKED) loadBlockedEntry();
    else loadCrafTech();
});
