import { loadMarked } from "./lib-blog.js";

console.log("Bottom-page module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[bottom-page.js] Not the homepage, halting module.");
}

const THEME_URL   = "/config/theme.json";
const VERSION_URL = "/config/version.txt";
const DEFAULT_LOAD_DELAY_MS = 2000;

const SITE_URL    = "https://canaancope.land/";
const REPO_URL    = "https://github.com/CanaanJC/CanaanCope.Land";
const LICENSE_URL = "https://raw.githubusercontent.com/CanaanJC/CanaanCope.Land/refs/heads/main/LICENSE.md";

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

function buildVersionLink(text, href) {
    const a = document.createElement("a");
    a.className = "site-credit__version-link";
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
}

function buildVersionLine(version) {
    const versionLine = document.createElement("span");
    versionLine.className = "site-credit__version";

    versionLine.appendChild(buildVersionLink(`v${version}`, `${REPO_URL}/releases/tag/${version}`));
    versionLine.appendChild(document.createTextNode(" \u00B7 "));
    versionLine.appendChild(buildVersionLink("Source", REPO_URL));
    versionLine.appendChild(document.createTextNode(" \u00B7 "));
    versionLine.appendChild(buildVersionLink("AGPLv3", LICENSE_URL));

    return versionLine;
}

function buildCreditBlock(version) {
    const wrap = document.createElement("div");
    wrap.id = "site-credit";
    wrap.className = "site-credit";

    const iconLink = document.createElement("a");
    iconLink.className = "site-credit__icon-link";
    iconLink.href = SITE_URL;
    iconLink.target = "_blank";
    iconLink.rel = "noopener noreferrer";

    const img = document.createElement("img");
    img.className = "site-credit__icon";
    img.src = "https://canaancope.land/media/logo.png";
    img.alt = "Canaan Copeland";
    img.loading = "lazy";

    iconLink.appendChild(img);

    const textWrap = document.createElement("span");
    textWrap.className = "site-credit__text-wrap";

    if (version) {
        textWrap.appendChild(buildVersionLine(version));
    }

    const textLink = document.createElement("a");
    textLink.className = "site-credit__text-link";
    textLink.href = SITE_URL;
    textLink.target = "_blank";
    textLink.rel = "noopener noreferrer";

    const text = document.createElement("span");
    text.className = "site-credit__text";
    text.textContent = "Site designed by Canaan Copeland 🇨🇦";
    textLink.appendChild(text);
    textWrap.appendChild(textLink);

    wrap.appendChild(iconLink);
    wrap.appendChild(textWrap);
    return wrap;
}

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

function pinToBottomForever(container, group) {
    let pinning = false;

    const observer = new MutationObserver(() => {
        if (pinning) return;
        if (container.lastElementChild === group) return; // already pinned — nothing to do

        pinning = true;
        container.appendChild(group); // re-appending an existing node moves it
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

    setTimeout(() => {
        const group = buildGroup(bottomText, version);
        container.appendChild(group);
        pinToBottomForever(container, group);
    }, loadDelayMs);
}

document.addEventListener("DOMContentLoaded", () => {
    init();
});