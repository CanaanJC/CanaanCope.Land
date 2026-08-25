import { loadMarked } from "./lib-blog.js";

console.log("Bottom-page module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[bottom-page.js] Not the homepage, halting module.");
}

const THEME_URL   = "/config/theme.json";
const VERSION_URL = "/config/version.txt";
const DEFAULT_LOAD_DELAY_MS = 2000;

async function fetchTheme() {
    try {
        const res = await fetch(`${THEME_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`theme.json HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        console.error("Bottom-page: failed to load theme.json:", err);
        return {};
    }
}

async function fetchVersion() {
    try {
        const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`version.txt HTTP ${res.status}`);
        const text = await res.text();
        return text.trim();
    } catch (err) {
        console.error("Bottom-page: failed to load version.txt:", err);
        return "";
    }
}

function buildBottomTextBlock(bottomText) {
    const el = document.createElement("div");
    el.id = "bottom-text";
    el.className = "bottom-text";
    el.innerHTML = window.marked.parse(bottomText);
    return el;
}

function buildCreditBlock(version) {
    const link = document.createElement("a");
    link.id = "site-credit";
    link.className = "site-credit";
    link.href = "https://canaancope.land/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.className = "site-credit__icon";
    img.src = "https://canaancope.land/media/logo.png";
    img.alt = "Canaan Copeland";
    img.loading = "lazy";

    // Both lines live in their own column so the pair, together, stay
    // vertically centered against the icon regardless of whether the
    // version line is present.
    const textWrap = document.createElement("span");
    textWrap.className = "site-credit__text-wrap";

    if (version) {
        const versionLine = document.createElement("span");
        versionLine.className = "site-credit__version";
        versionLine.textContent = `v${version}`;
        textWrap.appendChild(versionLine);
    }

    const text = document.createElement("span");
    text.className = "site-credit__text";
    text.textContent = "Site designed by Canaan Copeland";
    textWrap.appendChild(text);

    link.appendChild(img);
    link.appendChild(textWrap);
    return link;
}

// Builds the single combined group — bottom-text (if configured) stacked
// above the credit line, both inside one wrapper so they always move/load
// together as a unit, at the same visual elevation.
function buildGroup(bottomText, version) {
    const group = document.createElement("div");
    group.id = "bottom-page";
    group.className = "bottom-page";

    if (bottomText) {
        group.appendChild(buildBottomTextBlock(bottomText));
    }
    group.appendChild(buildCreditBlock(version));

    return group;
}

// Keeps `group` pinned as the LAST child of `container` forever — not just
// once at load time. The homepage keeps lazy-loading featured project
// content further down as the user scrolls (see featured.js), so a single
// one-time placement would eventually end up sitting above newly-loaded
// content instead of below it. This re-appends the group any time
// something else lands after it, and nothing else — no repeated
// self-triggering, no fighting with a second observer (there's only ever
// one group now, so there's nothing to ping-pong against).
function pinToBottomForever(container, group) {
    let pinning = false;

    const observer = new MutationObserver(() => {
        if (pinning) return;
        if (container.lastElementChild === group) return; // already pinned — nothing to do

        pinning = true;
        container.appendChild(group); // re-appending an existing node moves it
        // Let this mutation (our own move) finish flushing to the observer's
        // queue before allowing the guard to reopen, so it never reacts to
        // its own move as if it were new content.
        setTimeout(() => { pinning = false; }, 0);
    });

    observer.observe(container, { childList: true });
}

async function init() {
    const container = document.getElementById("content");
    if (!container) return;

    const [theme, version] = await Promise.all([fetchTheme(), fetchVersion()]);

    const bottomText   = typeof theme.bottomText === "string" ? theme.bottomText.trim() : "";
    const loadDelayMs  = typeof theme.bottomPageLoadDelayMs === "number"
        ? theme.bottomPageLoadDelayMs
        : DEFAULT_LOAD_DELAY_MS;

    if (bottomText) {
        await loadMarked();
    }

    // Single hardcoded (config-driven) delay before this group ever appears
    // at all — purely cosmetic, avoids any flicker while the rest of the
    // homepage is still loading/settling.
    setTimeout(() => {
        const group = buildGroup(bottomText, version);
        container.appendChild(group);
        pinToBottomForever(container, group);
    }, loadDelayMs);
}

document.addEventListener("DOMContentLoaded", () => {
    init();
});
