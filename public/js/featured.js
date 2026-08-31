import {
    loadMarked,
    getEndDate,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

import { libraryUsesDates, compareFolderNames } from "./lib-nav.js";

console.log("Featured module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[featured.js] Not the homepage, halting module.");
}

const PRELOAD_AHEAD  = 2;
const LIBRARIES_URL  = "/config/libraries.json";

const DISABLE_LAZY = false;

const _entryRegistry = new Map();

function safeIdPart(str) {
    return String(str).replace(/[^A-Za-z0-9_-]/g, "_");
}

function entryElementId(library, slugPath) {
    return `featured-${safeIdPart(library.path)}--${slugPath.map(safeIdPart).join("--")}`;
}

function parseFlexibleDate(dateStr) {
    if (typeof dateStr !== "string") return null;
    const parts = dateStr.trim().split(/[/-]/);
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(n => parseInt(n, 10));
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
}

function compareFeatured(a, b) {
    const aUndated = !a.parsedDate;
    const bUndated = !b.parsedDate;

    if (aUndated && bUndated) {
        return compareFolderNames(a.sortName, b.sortName);
    }

    if (aUndated) return -1;
    if (bUndated) return 1;

    return b.parsedDate - a.parsedDate;
}

async function fetchEntryFiles(library, slugPath) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    const [configRes, mdRes] = await Promise.all([
        fetch(`${base}/config.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`${base}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
    ]);
    if (!configRes.ok) throw new Error(`${base}/config.json → HTTP ${configRes.status}`);
    if (!mdRes.ok)     throw new Error(`${base}/content.md → HTTP ${mdRes.status}`);
    return { config: await configRes.json(), rawMd: await mdRes.text() };
}

function buildBlock(library, slugPath, config, rawMd) {
    const base = `/${library.path}/${slugPath.map(encodeURIComponent).join("/")}`;
    const hasDate = Array.isArray(config.date) ? config.date.length > 0 : !!config.date;
    return buildProjectBlock({
        elementId:      entryElementId(library, slugPath),
        title:          config.name || slugPath[slugPath.length - 1],
        date:           hasDate ? config.date : null,
        rawMd,
        mediaBaseUrl:   `${base}/media`,
        listingBaseUrl: `${base}/media-listing`,
    });
}

async function loadFeaturedEntry(elementId) {
    const found = _entryRegistry.get(elementId);
    if (!found) {
        console.error(`Featured: no registry entry for id "${elementId}".`);
        return null;
    }
    const { library, slugPath } = found;
    try {
        const { config, rawMd } = await fetchEntryFiles(library, slugPath);
        return buildBlock(library, slugPath, config, rawMd);
    } catch (err) {
        console.error(`Featured: lazy-load failed for "${library.path}/${slugPath.join("/")}":`, err.message);
        return null;
    }
}

async function collectFeatured(libraries) {
    const results = await Promise.all(
        libraries.map(async (library, libraryIndex) => {
            const url = `/${library.path}/manifest.json?_=${Date.now()}`;
            let manifest;

            try {
                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) {
                    console.error(
                        `Featured: manifest for "${library.path}" returned HTTP ${res.status} (${url}).`
                    );
                    return [];
                }
                manifest = await res.json();
            } catch (err) {
                console.error(`Featured: failed to fetch manifest for "${library.path}" (${url}):`, err.message);
                return [];
            }

            if (!Array.isArray(manifest)) {
                console.error(`Featured: manifest for "${library.path}" is not an array.`);
                return [];
            }
            if (manifest.length === 0) {
                console.warn(
                    `Featured: manifest for "${library.path}" is EMPTY. At depth ${library.depth}, ` +
                    `each entry needs a config.json exactly ${library.depth} folder level(s) below ` +
                    `public/libraries/${library.path}/ and must not have "block": true.`
                );
                return [];
            }

            const usesDates = libraryUsesDates(library);
            const featured = [];

            manifest.forEach((entry, manifestIndex) => {
                if (!entry || entry.featured !== true) return;

                if (!Array.isArray(entry.slugPath) || entry.slugPath.length !== library.depth) {
                    console.warn(
                        `Featured: skipping malformed entry in "${library.path}" — ` +
                        `slugPath ${JSON.stringify(entry.slugPath)} doesn't match depth ${library.depth}.`
                    );
                    return;
                }

                const rawEnd = getEndDate(entry.date);
                const parsedDate = usesDates ? parseFlexibleDate(rawEnd) : null;

                if (usesDates && rawEnd && !parsedDate) {
                    console.warn(
                        `Featured: "${library.path}/${entry.slugPath.join("/")}" has an unparseable ` +
                        `date "${rawEnd}" — expected YYYY/MM/DD or YYYY-MM-DD. Treating as undated.`
                    );
                }

                featured.push({
                    library,
                    libraryIndex,
                    manifestIndex,
                    slugPath: entry.slugPath,
                    parsedDate,
                    sortName: entry.slugPath[entry.slugPath.length - 1] || "",
                });
            });

            console.log(
                `Featured: "${library.path}" (depth ${library.depth}, ` +
                `${usesDates ? "date mode" : "title mode"}) — ` +
                `${manifest.length} entr${manifest.length === 1 ? "y" : "ies"}, ${featured.length} featured.`
            );

            return featured;
        })
    );

    return results.flat();
}

async function loadFeatured() {
    const container = document.getElementById("content");
    if (!container) return;

    await loadMarked();

    let libraries = [];
    try {
        const res = await fetch(`${LIBRARIES_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`libraries.json HTTP ${res.status}`);
        libraries = await res.json();
    } catch (err) {
        console.error("Featured: failed to fetch libraries.json:", err);
        return;
    }
    if (!Array.isArray(libraries) || libraries.length === 0) {
        console.warn("Featured: libraries.json is empty — nothing to feature.");
        return;
    }

    const allFeatured = await collectFeatured(libraries);

    window.__FEATURED_DEBUG__ = {
        libraries,
        featured: allFeatured.map(f => ({
            library: f.library.path,
            depth: f.library.depth,
            slugPath: f.slugPath,
            sortName: f.sortName,
            parsedDate: f.parsedDate,
            id: entryElementId(f.library, f.slugPath),
        })),
    };

    if (!allFeatured.length) {
        console.warn(
            "Featured: no entry in any library has \"featured\": true. " +
            "Inspect window.__FEATURED_DEBUG__ for what was discovered."
        );
        return;
    }

    const sorted = [...allFeatured].sort(compareFeatured);

    console.log(
        "Featured: render order →",
        sorted.map(s =>
            `${s.library.path}/${s.slugPath.join("/")}` +
            (s.parsedDate ? ` [${s.parsedDate.toISOString().slice(0, 10)}]` : " [undated]")
        )
    );

    for (const item of sorted) {
        _entryRegistry.set(entryElementId(item.library, item.slugPath), {
            library: item.library,
            slugPath: item.slugPath,
        });
    }

    const eagerCutoff = DISABLE_LAZY ? sorted.length : PRELOAD_AHEAD + 1;
    const eagerList   = sorted.slice(0, eagerCutoff);
    const lazyList    = sorted.slice(eagerCutoff);

    const eagerLoaded = await Promise.all(
        eagerList.map(async ({ library, slugPath }) => {
            const id = entryElementId(library, slugPath);
            try {
                const { config, rawMd } = await fetchEntryFiles(library, slugPath);
                return { id, dom: buildBlock(library, slugPath, config, rawMd) };
            } catch (err) {
                console.error(`Featured: eager load failed for "${library.path}/${slugPath.join("/")}":`, err.message);
                return { id, dom: createPlaceholder(id) };
            }
        })
    );

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

    const aboutMe = document.getElementById("about-me-content");
    if (aboutMe && aboutMe.parentNode) {
        aboutMe.parentNode.insertBefore(wrapper, aboutMe.nextSibling);
    } else {
        container.appendChild(wrapper);
    }

    if (lazyList.length > 0) {
        const lazyIds = lazyList.map(({ library, slugPath }) => entryElementId(library, slugPath));
        setupLazyLoading(lazyIds, loadFeaturedEntry, PRELOAD_AHEAD);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadFeatured();
});
