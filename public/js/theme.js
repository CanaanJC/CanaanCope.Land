console.log("Theme module loaded");

const THEME_URL = "/config/theme.json";

function setFavicon(href) {
    if (!href) return;
    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
    }
    link.href = href;
}

function applyThemeVars(theme) {
    if (!theme) return;
    const root = document.documentElement.style;

    if (theme.backgroundColor) root.setProperty("--bg", theme.backgroundColor);

    if (theme.page) {
        if (theme.page.fontFamily) root.setProperty("--page-font-family", theme.page.fontFamily);
        if (theme.page.textColor)  root.setProperty("--page-text-color", theme.page.textColor);

        const c = theme.page.code;
        if (c) {
            if (c.backgroundColor)      root.setProperty("--md-code-bg", c.backgroundColor);
            if (c.borderColor)          root.setProperty("--md-code-border", c.borderColor);
            if (c.textColor)            root.setProperty("--md-code-text", c.textColor);
            if (c.blockBackgroundColor) root.setProperty("--md-block-bg", c.blockBackgroundColor);
            if (c.blockBorderColor)     root.setProperty("--md-block-border", c.blockBorderColor);
        }
    }

    if (theme.topbar) {
        if (theme.topbar.backgroundColor) root.setProperty("--topbar-bg", theme.topbar.backgroundColor);
        if (theme.topbar.depth != null)    root.setProperty("--topbar-depth", `${theme.topbar.depth}px`);

        const s = theme.topbar.slogan;
        if (s) {
            if (s.fontFamily) root.setProperty("--slogan-font-family", s.fontFamily);
            if (s.fontSize != null) root.setProperty("--slogan-font-size", `${s.fontSize}px`);
            if (s.color) root.setProperty("--slogan-color", s.color);
        }
    }

    if (theme.sidebar) {
        if (theme.sidebar.backgroundColor)   root.setProperty("--sidebar-bg", theme.sidebar.backgroundColor);
        if (theme.sidebar.collapsedWidth != null) root.setProperty("--sidebar-collapsed", `${theme.sidebar.collapsedWidth}px`);
        if (theme.sidebar.expandedWidth != null)  root.setProperty("--sidebar-expanded", `${theme.sidebar.expandedWidth}px`);
    }

    if (theme.bottomText) {
        const b = theme.bottomText;
        if (b.fontFamily) root.setProperty("--bottom-text-font-family", b.fontFamily);
        if (b.fontSize != null) root.setProperty("--bottom-text-font-size", `${b.fontSize}px`);
        if (b.color) root.setProperty("--bottom-text-color", b.color);
    }
}

async function loadTheme() {
    try {
        const res = await fetch(`${THEME_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`theme.json HTTP ${res.status}`);
        const data = await res.json();

        setFavicon(data.favicon);
        applyThemeVars(data.theme);

        // Exposed for other modules (e.g. topbar.js) that also need favicon/
        // slogan/theme data without a second fetch.
        window.__SITE_THEME__ = data;
    } catch (err) {
        console.error("Theme: failed to load theme.json:", err);
    }
}

document.addEventListener("DOMContentLoaded", loadTheme);
