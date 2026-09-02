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
    text.textContent = "Site designed by Canaan Copeland 🇨🇦";
    textWrap.appendChild(text);

    link.appendChild(img);
    link.appendChild(textWrap);
    return link;
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
