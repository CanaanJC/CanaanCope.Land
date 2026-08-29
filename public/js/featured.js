import {
    loadMarked,
    sortByEndDate,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

console.log("Featured module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[featured.js] Not the homepage, halting module.");
}

const PRELOAD_AHEAD  = 2;
const LIBRARIES_URL  = "/config/libraries.json";

// elementId -> { library, slugPath } — populated once at boot so the lazy
// loader can look an entry back up without needing to encode/decode its
// library path + slug segments into the DOM id string itself.
const _entryRegistry = new Map();

function entryElementId(library, slugPath) {
    return `featured-${library.path}--${slugPath.join("--")}`;
}

// ── Single entry loader (used by both eager and lazy paths) ──────────────────
// Works for ANY library (projects, small-projects, template, CrafTech, or
// anything added later) — not just a hardcoded pair — since it's driven by
// the entry's own library + slugPath rather than a fixed "section" string.

async function fetchEntryFiles(library, slugPath) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    const [configRes, mdRes] = await Promise.all([
        fetch(`${base}/config.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`${base}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
    ]);
    if (!configRes.ok || !mdRes.ok) throw new Error(`Failed to load ${base}`);
    const config = await configRes.json();
    const rawMd  = await mdRes.text();
    return { config, rawMd };
}

function buildBlock(library, slugPath, config, rawMd) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    return buildProjectBlock({
        elementId:      entryElementId(library, slugPath),
        title:          config.name || slugPath[slugPath.length - 1],
        date:           config.date,
        rawMd,
        mediaBaseUrl:   `${base}/media`,
        listingBaseUrl: `${base}/media-listing`,
    });
}

// ── Lazy loader for an individual featured entry ─────────────────────────────

async function loadFeaturedEntry(elementId) {
    const found = _entryRegistry.get(elementId);
    if (!found) return null;
    const { library, slugPath } = found;
    try {
        const { config, rawMd } = await fetchEntryFiles(library, slugPath);
        return buildBlock(library, slugPath, config, rawMd);
    } catch (err) {
        console.error(`Featured: failed to lazy-load "${library.path}/${slugPath.join("/")}":`, err);
        return null;
    }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function loadFeatured() {
    const container = document.getElementById("content");
    if (!container) return;

    await loadMarked();

    let libraries = [];
    try {
        const res = await fetch(`${LIBRARIES_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) libraries = await res.json();
    } catch (err) {
        console.error("Featured: failed to fetch libraries.json:", err);
        return;
    }
    if (!Array.isArray(libraries) || libraries.length === 0) return;

    // Fetch every library's manifest in parallel and pull out entries marked
    // featured. Hidden libraries (a nav-dropdown-only concern) are still
    // included here — hidden never affects featured eligibility.
    const manifestResults = await Promise.all(
        libraries.map(async (library) => {
            try {
                const res = await fetch(`/${library.path}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
                if (!res.ok) return [];
                const manifest = await res.json();
                if (!Array.isArray(manifest)) return [];
                return manifest
                    .filter(entry => entry.featured)
                    .map(entry => ({ library, slugPath: entry.slugPath, date: entry.date }));
            } catch (err) {
                console.error(`Featured: failed to fetch manifest for "${library.path}":`, err);
                return [];
            }
        })
    );

    const allFeatured = manifestResults.flat();
    if (!allFeatured.length) return;

    const sorted = sortByEndDate(allFeatured);

    for (const item of sorted) {
        _entryRegistry.set(entryElementId(item.library, item.slugPath), {
            library: item.library,
            slugPath: item.slugPath,
        });
    }

    // ── Split into eager (first PRELOAD_AHEAD + 1) and lazy ──────────────────

    const eagerCutoff = PRELOAD_AHEAD;
    const eagerList = sorted.slice(0, eagerCutoff + 1);
    const lazyList  = sorted.slice(eagerCutoff + 1);

    // ── Eager fetch ─────────────────────────────────────────────────────────

    const eagerLoaded = await Promise.all(
        eagerList.map(async ({ library, slugPath }) => {
            const id = entryElementId(library, slugPath);
            try {
                const { config, rawMd } = await fetchEntryFiles(library, slugPath);
                return { id, dom: buildBlock(library, slugPath, config, rawMd) };
            } catch (err) {
                console.error(`Featured: eager load failed for "${library.path}/${slugPath.join("/")}":`, err);
                return { id, dom: createPlaceholder(id) };
            }
        })
    );

    // ── Build wrapper — no "Featured Projects" heading, just the divider
    // sitting directly below the about-me content ────────────────────────────

    const wrapper = document.createElement("div");
    wrapper.id = "featured-content";

    const openingDivider = document.createElement("hr");
    openingDivider.className = "blog-divider blog-divider--after-heading";
    wrapper.appendChild(openingDivider);

    const allOrdered = [
        ...eagerLoaded,
        ...lazyList.map(({ library, slugPath }) => {
            const id = entryElementId(library, slugPath);
            return { id, dom: createPlaceholder(id) };
        }),
    ];

    allOrdered.forEach(({ dom }, i) => {
        if (i > 0) {
            const hr = document.createElement("hr");
            hr.className = "blog-divider";
            wrapper.appendChild(hr);
        }
        wrapper.appendChild(dom);
    });

    // ── Insert into page ─────────────────────────────────────────────────────

    const aboutMe = document.getElementById("about-me-content");
    if (aboutMe && aboutMe.parentNode) {
        aboutMe.parentNode.insertBefore(wrapper, aboutMe.nextSibling);
    } else {
        container.appendChild(wrapper);
    }

    // ── Lazy load remaining ──────────────────────────────────────────────────

    if (lazyList.length > 0) {
        const lazyIds = lazyList.map(({ library, slugPath }) => entryElementId(library, slugPath));
        setupLazyLoading(lazyIds, loadFeaturedEntry, PRELOAD_AHEAD);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadFeatured();
});
