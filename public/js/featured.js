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

const PRELOAD_AHEAD = 2;

// ── Single project loader (used by both eager and lazy paths) ────────────────

async function fetchProjectFiles(section, slug) {
    const [configRes, mdRes] = await Promise.all([
        fetch(`/${section}/${slug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/${section}/${slug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
    ]);
    if (!configRes.ok || !mdRes.ok) throw new Error(`Failed to load /${section}/${slug}`);
    const config = await configRes.json();
    const rawMd  = await mdRes.text();
    return { config, rawMd };
}

function buildBlock(section, slug, config, rawMd) {
    return buildProjectBlock({
        elementId:      `featured-${section}-${slug}`,
        title:          config.name || slug,
        date:           config.date,
        rawMd,
        mediaBaseUrl:   `/${section}/${slug}/media`,
        listingBaseUrl: `/${section}/${slug}/media-listing`,
    });
}

// ── Lazy loader for an individual featured project ───────────────────────────

async function loadFeaturedProject(elementId) {
    // elementId format: "featured-<section>-<slug>"
    const match = elementId.match(/^featured-(projects|small-projects)-(.+)$/);
    if (!match) return null;
    const section = match[1];
    const slug    = match[2];
    try {
        const { config, rawMd } = await fetchProjectFiles(section, slug);
        return buildBlock(section, slug, config, rawMd);
    } catch (err) {
        console.error(`Featured: failed to lazy-load "${section}/${slug}":`, err);
        return null;
    }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

async function loadFeatured() {
    const container = document.getElementById("content");
    if (!container) return;

    await loadMarked();

    let projectsManifest = [];
    let smallManifest    = [];

    try {
        const [pRes, sRes] = await Promise.all([
            fetch(`/projects/manifest.json?_=${Date.now()}`,       { cache: "no-store" }),
            fetch(`/small-projects/manifest.json?_=${Date.now()}`, { cache: "no-store" }),
        ]);
        if (pRes.ok) projectsManifest = await pRes.json();
        if (sRes.ok) smallManifest    = await sRes.json();
    } catch (err) {
        console.error("Featured: failed to fetch manifests:", err);
        return;
    }

    const allFeatured = [
        ...projectsManifest.map(p => ({ ...p, section: "projects" })),
        ...smallManifest.map(p =>    ({ ...p, section: "small-projects" })),
    ].filter(p => p.featured);

    if (!allFeatured.length) return;

    const sorted = sortByEndDate(allFeatured);

    // ── Split into eager (first PRELOAD_AHEAD + 1) and lazy ──────────────────

    const eagerCutoff = PRELOAD_AHEAD;
    const eagerList = sorted.slice(0, eagerCutoff + 1);
    const lazyList  = sorted.slice(eagerCutoff + 1);

    // ── Eager fetch ─────────────────────────────────────────────────────────

    const eagerLoaded = await Promise.all(
        eagerList.map(async ({ slug, section }) => {
            try {
                const { config, rawMd } = await fetchProjectFiles(section, slug);
                return { slug, section, dom: buildBlock(section, slug, config, rawMd) };
            } catch (err) {
                console.error(`Featured: eager load failed for "${section}/${slug}":`, err);
                return { slug, section, dom: createPlaceholder(`featured-${section}-${slug}`) };
            }
        })
    );

    // ── Build wrapper ────────────────────────────────────────────────────────

    const wrapper = document.createElement("div");
    wrapper.id = "featured-content";

    const sectionTitle = document.createElement("h2");
    sectionTitle.className = "blog-section-title";
    sectionTitle.textContent = "Featured Projects";
    wrapper.appendChild(sectionTitle);

    const openingDivider = document.createElement("hr");
    openingDivider.className = "blog-divider blog-divider--after-heading";
    wrapper.appendChild(openingDivider);

    const allOrdered = [
        ...eagerLoaded,
        ...lazyList.map(({ slug, section }) => ({
            slug,
            section,
            dom: createPlaceholder(`featured-${section}-${slug}`),
        })),
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
        const lazyIds = lazyList.map(({ slug, section }) => `featured-${section}-${slug}`);
        setupLazyLoading(lazyIds, loadFeaturedProject, PRELOAD_AHEAD);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadFeatured();
});
