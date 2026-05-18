import {
    loadMarked,
    sortByEndDate,
    getEndDate,
    buildProjectBlock,
    createPlaceholder,
    setupLazyLoading,
} from "./lib-blog.js";

console.log("Projects module loaded");

const PRELOAD_AHEAD = 2;

// ── Guard: only run on /projects or /small-projects pages ────────────────────

const _pathParts = window.location.pathname.split("/").filter(Boolean);
const _rootSection = _pathParts[0];
const IS_PROJECTS_PAGE = _rootSection === "projects" || _rootSection === "small-projects";
const IS_BLOCKED_PAGE  = !!window.__BLOCKED_SLUG__;

if (!IS_PROJECTS_PAGE && !IS_BLOCKED_PAGE) {
    throw new Error("[projects.js] Not a projects page, halting module.");
}

// ── Detect section ───────────────────────────────────────────────────────────

function detectSection() {
    if (window.__BLOCKED_SECTION__) return window.__BLOCKED_SECTION__;
    if (_rootSection === "small-projects") return "small-projects";
    return "projects";
}

const SECTION = detectSection();

// ── Single project loader ────────────────────────────────────────────────────

async function fetchProjectFiles(slug) {
    const [configRes, mdRes] = await Promise.all([
        fetch(`/${SECTION}/${slug}/config.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch(`/${SECTION}/${slug}/content.md?_=${Date.now()}`,  { cache: "no-store" }),
    ]);
    if (!configRes.ok || !mdRes.ok) throw new Error(`Failed to load ${slug}`);
    const config = await configRes.json();
    const rawMd  = await mdRes.text();
    return { config, rawMd };
}

function buildBlock(slug, config, rawMd) {
    return buildProjectBlock({
        elementId:      slug,
        title:          config.name || slug,
        date:           config.date,
        rawMd,
        mediaBaseUrl:   `/${SECTION}/${slug}/media`,
        listingBaseUrl: `/${SECTION}/${slug}/media-listing`,
    });
}

// ── Wait for topbar ──────────────────────────────────────────────────────────

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

// ── Topbar "By Month" dropdown ───────────────────────────────────────────────

function scrollToSlug(slug) {
    const el = document.getElementById(slug) || document.getElementById(`placeholder-${slug}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildTopbarMonthNav(sortedManifest) {
    const yearToSlug  = new Map();
    const monthToSlug = new Map();
    const yearMonths  = new Map();

    for (const project of sortedManifest) {
        const endDate = getEndDate(project.date);
        if (!endDate) continue;
        const parts = endDate.split("/");
        if (parts.length < 2) continue;
        const year  = parts[0];
        const month = parts[1].padStart(2, "0");
        const key   = `${year}/${month}`;
        if (!yearToSlug.has(year))  yearToSlug.set(year, project.slug);
        if (!monthToSlug.has(key))  monthToSlug.set(key, project.slug);
        if (!yearMonths.has(year))  yearMonths.set(year, new Set());
        yearMonths.get(year).add(month);
    }

    const years = [...yearMonths.keys()].sort((a, b) => Number(b) - Number(a));

    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "month-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = "By Month";
    wrapper.appendChild(trigger);

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const year of years) {
        const yearBtn = document.createElement("button");
        yearBtn.className = "topbar-dropdown__item topbar-month-nav--year";
        yearBtn.textContent = year;
        yearBtn.addEventListener("click", (e) => {
            e.preventDefault();
            wrapper.classList.remove("open");
            scrollToSlug(yearToSlug.get(year));
        });
        menu.appendChild(yearBtn);

        const months = [...yearMonths.get(year)].sort((a, b) => Number(b) - Number(a));
        for (const month of months) {
            const monthBtn = document.createElement("button");
            monthBtn.className = "topbar-dropdown__item topbar-month-nav--month";
            monthBtn.textContent = month;
            monthBtn.addEventListener("click", (e) => {
                e.preventDefault();
                wrapper.classList.remove("open");
                scrollToSlug(monthToSlug.get(`${year}/${month}`));
            });
            menu.appendChild(monthBtn);
        }
    }

    wrapper.appendChild(menu);
    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));
    return wrapper;
}

async function injectTopbarMonthNav(sortedManifest) {
    if (!sortedManifest.length) return;
    const topbar = await waitForTopbar();
    if (!topbar) return;
    for (const el of [...topbar.querySelectorAll(".topbar-dropdown")]) el.remove();
    const logo = topbar.querySelector(".topbar-logo");
    const nav  = buildTopbarMonthNav(sortedManifest);
    if (logo && logo.nextSibling) topbar.insertBefore(nav, logo.nextSibling);
    else topbar.appendChild(nav);
}

// ── Scroll tracking (URL updates) ────────────────────────────────────────────

function setupScrollTracking(slugs) {
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const slug   = entry.target.id;
                    const newUrl = `/${SECTION}/${slug}`;
                    if (window.location.pathname !== newUrl) history.replaceState(null, "", newUrl);
                }
            }
        },
        { rootMargin: "0px 0px -80% 0px", threshold: 0 }
    );
    for (const slug of slugs) {
        const el = document.getElementById(slug);
        if (el) observer.observe(el);
    }
}

// ── Lazy load callback ───────────────────────────────────────────────────────

async function loadProjectBySlug(slug) {
    try {
        const { config, rawMd } = await fetchProjectFiles(slug);
        const dom = buildBlock(slug, config, rawMd);
        setupScrollTracking([slug]);
        return dom;
    } catch (err) {
        console.error(`Failed to load project "${slug}":`, err);
        return null;
    }
}

// ── Blocked project mode ─────────────────────────────────────────────────────

async function loadBlockedProject(slug) {
    const container = document.getElementById("projects-container");
    if (!container) return;
    await loadMarked();
    try {
        const { config, rawMd } = await fetchProjectFiles(slug);
        container.appendChild(buildBlock(slug, config, rawMd));
    } catch (err) {
        console.error(`Failed to load blocked project "${slug}":`, err);
    }
}

// ── Normal mode ──────────────────────────────────────────────────────────────

async function loadProjects() {
    const container = document.getElementById("projects-container");
    if (!container) return;

    await loadMarked();

    let manifest;
    try {
        const res = await fetch(`/${SECTION}/manifest.json?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
        manifest = await res.json();
    } catch (err) {
        console.error("Failed to load project manifest:", err);
        return;
    }

    if (!manifest.length) {
        container.innerHTML = `<p style="color:var(--muted);padding:48px;">No projects yet.</p>`;
        return;
    }

    manifest = sortByEndDate(manifest);
    injectTopbarMonthNav(manifest);

    const urlSlug = (() => {
        const hash = window.location.hash.replace("#", "");
        if (hash) return hash;
        const parts = window.location.pathname.split("/").filter(Boolean);
        return parts.length >= 2 ? parts[1] : null;
    })();

    const targetIndex = urlSlug ? Math.max(manifest.findIndex(p => p.slug === urlSlug), 0) : 0;
    const eagerCutoff = targetIndex + PRELOAD_AHEAD;

    const eagerSlugs = [];
    const lazySlugs  = [];
    for (let i = 0; i < manifest.length; i++) {
        (i <= eagerCutoff ? eagerSlugs : lazySlugs).push(manifest[i].slug);
    }

    const allSlugs = manifest.map(p => p.slug);

    const eagerResults = await Promise.all(
        eagerSlugs.map(async slug => {
            try {
                const { config, rawMd } = await fetchProjectFiles(slug);
                return { slug, dom: buildBlock(slug, config, rawMd) };
            } catch {
                console.error(`Failed to eagerly load "${slug}"`);
                return { slug, dom: createPlaceholder(slug) };
            }
        })
    );

    for (let i = 0; i < allSlugs.length; i++) {
        const slug = allSlugs[i];
        if (i > 0) {
            const hr = document.createElement("hr");
            hr.className = "blog-divider";
            container.appendChild(hr);
        }
        const eager = eagerResults.find(r => r.slug === slug);
        container.appendChild(eager ? eager.dom : createPlaceholder(slug));
    }

    if (urlSlug) {
        const target = document.getElementById(urlSlug);
        if (target) setTimeout(() => target.scrollIntoView({ behavior: "instant", block: "start" }), 50);
    }

    setupScrollTracking(eagerSlugs);
    if (lazySlugs.length > 0) setupLazyLoading(lazySlugs, loadProjectBySlug, PRELOAD_AHEAD);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    if (window.__BLOCKED_SLUG__) loadBlockedProject(window.__BLOCKED_SLUG__);
    else loadProjects();
});
