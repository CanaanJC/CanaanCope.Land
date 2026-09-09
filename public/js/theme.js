console.log("Theme module loaded");

const THEME_URL = "/config/theme.json";

const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
const MONO_FONT_STACK   = '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace';

let _revealed = false;
let _revealTimer = null;

function revealPage() {
    if (_revealed) return;
    _revealed = true;
    if (_revealTimer) {
        clearTimeout(_revealTimer);
        _revealTimer = null;
    }
    document.documentElement.classList.add("theme-ready");
}

_revealTimer = setTimeout(() => {
    console.warn("Theme: reveal safety timeout hit — showing page with whatever theme is applied.");
    revealPage();
}, 2500);

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

const FONT_VAR_MAP = {
    body: {
        varName:   "--page-font-family",
        weightVar: "--page-font-weight",
        styleVar:  "--page-font-style",
        axesVar:   "--page-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    topbar: {
        varName:   "--topbar-font-family",
        weightVar: "--topbar-font-weight",
        styleVar:  "--topbar-font-style",
        axesVar:   "--topbar-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    slogan: {
        varName:   "--slogan-font-family",
        weightVar: "--slogan-font-weight",
        styleVar:  "--slogan-font-style",
        axesVar:   "--slogan-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    sidebar: {
        varName:   "--sidebar-font-family",
        weightVar: "--sidebar-font-weight",
        styleVar:  "--sidebar-font-style",
        axesVar:   "--sidebar-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    bottomText: {
        varName:   "--bottom-text-font-family",
        weightVar: "--bottom-text-font-weight",
        styleVar:  "--bottom-text-font-style",
        axesVar:   "--bottom-text-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    code: {
        varName:   "--md-code-font-family",
        weightVar: "--md-code-font-weight",
        styleVar:  "--md-code-font-style",
        axesVar:   "--md-code-font-variation-settings",
        stack:     MONO_FONT_STACK,
    },
    dropdownFolder: {
        varName:   "--dropdown-folder-font-family",
        weightVar: "--dropdown-folder-font-weight",
        styleVar:  "--dropdown-folder-font-style",
        axesVar:   "--dropdown-folder-font-variation-settings",
        stack:     SYSTEM_FONT_STACK,
    },
    dropdownBlog: {
        varName:   "--dropdown-blog-font-family",
        weightVar: "--dropdown-blog-font-weight",
        styleVar:  "--dropdown-blog-font-style",
        axesVar:   "--dropdown-blog-font-variation-settings",
        stack:     MONO_FONT_STACK,
    },
};

const GOOGLE_LINK_ATTR   = "data-theme-google-font";
const GOOGLE_PRECONNECT  = "theme-google-fonts-preconnect";

let _fontStyleEl = null;

function getFontStyleEl() {
    if (_fontStyleEl) return _fontStyleEl;
    _fontStyleEl = document.createElement("style");
    _fontStyleEl.id = "theme-custom-fonts";
    document.head.appendChild(_fontStyleEl);
    return _fontStyleEl;
}

function cssFamilyName(name) {
    return String(name).replace(/[\\"]/g, "");
}

function fontFaceRule(font) {
    return `@font-face { font-family: "${cssFamilyName(font.family)}"; src: url("${font.url}") format("${font.format}"); font-display: swap; }`;
}

function safeGoogleStylesheet(href) {
    try {
        const url = new URL(String(href), window.location.href);
        if (url.protocol !== "https:") return null;
        if (url.hostname !== "fonts.googleapis.com") return null;
        return url.href;
    } catch {
        return null;
    }
}

function ensureGooglePreconnect() {
    if (document.getElementById(GOOGLE_PRECONNECT)) return;

    const api = document.createElement("link");
    api.id = GOOGLE_PRECONNECT;
    api.rel = "preconnect";
    api.href = "https://fonts.googleapis.com";

    const statics = document.createElement("link");
    statics.rel = "preconnect";
    statics.href = "https://fonts.gstatic.com";
    statics.crossOrigin = "anonymous";

    document.head.appendChild(api);
    document.head.appendChild(statics);
}

function syncGoogleFontLinks(hrefs) {
    const wanted = [];
    for (const href of hrefs) {
        if (href && !wanted.includes(href)) wanted.push(href);
    }

    const present = new Set();
    for (const link of document.querySelectorAll(`link[${GOOGLE_LINK_ATTR}]`)) {
        const href = link.getAttribute(GOOGLE_LINK_ATTR);
        if (wanted.includes(href) && !present.has(href)) {
            present.add(href);
        } else {
            link.remove();
        }
    }

    if (!wanted.length) return;
    ensureGooglePreconnect();

    for (const href of wanted) {
        if (present.has(href)) continue;
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.crossOrigin = "anonymous";
        link.setAttribute(GOOGLE_LINK_ATTR, href);
        document.head.appendChild(link);
    }
}

function fontKind(font) {
    if (!font || typeof font !== "object") return null;
    if (font.kind === "google" || font.kind === "local") return font.kind;
    if (font.url && font.format) return "local";
    if (font.stylesheet) return "google";
    return null;
}

function applyThemeFonts(fonts) {
    const root   = document.documentElement.style;
    const rules  = new Set();
    const sheets = [];

    for (const [key, cfg] of Object.entries(FONT_VAR_MAP)) {
        const font = fonts && fonts[key];
        const kind = fontKind(font);

        if (kind === "local" && font.family && font.url && font.format) {
            rules.add(fontFaceRule(font));
            root.setProperty(cfg.varName, `"${cssFamilyName(font.family)}", ${cfg.stack}`);
            root.removeProperty(cfg.weightVar);
            root.removeProperty(cfg.styleVar);
            root.removeProperty(cfg.axesVar);
            continue;
        }

        if (kind === "google" && font.family) {
            const href = safeGoogleStylesheet(font.stylesheet);
            if (href) {
                sheets.push(href);
                root.setProperty(cfg.varName, `"${cssFamilyName(font.family)}", ${cfg.stack}`);
                setOrClear(root, cfg.weightVar, font.weight);
                setOrClear(root, cfg.styleVar,  font.style);
                setOrClear(root, cfg.axesVar,   font.variationSettings);
                continue;
            }
        }

        root.removeProperty(cfg.varName);
        root.removeProperty(cfg.weightVar);
        root.removeProperty(cfg.styleVar);
        root.removeProperty(cfg.axesVar);
    }

    syncGoogleFontLinks(sheets);

    const styleEl  = getFontStyleEl();
    const combined = [...rules].join("\n");
    if (styleEl.textContent !== combined) styleEl.textContent = combined;
}

function px(n) {
    return (typeof n === "number" && !isNaN(n)) ? `${n}px` : null;
}

function setOrClear(root, varName, value) {
    if (value === null || value === undefined || value === "") {
        root.removeProperty(varName);
    } else {
        root.setProperty(varName, value);
    }
}

function applyThemeVars(theme) {
    if (!theme) return;
    const root = document.documentElement.style;

    const body = theme.body || {};
    setOrClear(root, "--bg",              body.backgroundColor);
    setOrClear(root, "--page-text-color", body.textColor);
    setOrClear(root, "--page-font-size",  px(body.fontSize));

    const dropdown = theme.dropdown || {};
    setOrClear(root, "--blog-divider-color", dropdown.dividerColor);
    if (dropdown.dividerWeight != null) root.setProperty("--blog-divider-weight", px(dropdown.dividerWeight));

    const dropdownFolder = dropdown.folder || {};
    setOrClear(root, "--dropdown-folder-color",        dropdownFolder.textColor);
    setOrClear(root, "--dropdown-folder-mobile-color", dropdownFolder.mobileTextColor);
    setOrClear(root, "--dropdown-folder-font-size",    px(dropdownFolder.fontSize));

    const dropdownBlog = dropdown.blog || {};
    setOrClear(root, "--dropdown-blog-color",        dropdownBlog.textColor);
    setOrClear(root, "--dropdown-blog-mobile-color", dropdownBlog.mobileTextColor);
    setOrClear(root, "--dropdown-blog-font-size",    px(dropdownBlog.fontSize));

    const topbar = theme.topbar || {};
    setOrClear(root, "--topbar-bg",         topbar.backgroundColor);
    setOrClear(root, "--topbar-text-color", topbar.textColor);
    setOrClear(root, "--topbar-font-size",  px(topbar.fontSize));
    if (topbar.depth != null) root.setProperty("--topbar-depth", px(topbar.depth));

    const slogan = topbar.slogan || {};
    setOrClear(root, "--slogan-color",     slogan.textColor);
    setOrClear(root, "--slogan-font-size", px(slogan.fontSize));

    const sidebar = theme.sidebar || {};
    setOrClear(root, "--sidebar-bg",         sidebar.backgroundColor);
    setOrClear(root, "--sidebar-text-color", sidebar.textColor);
    setOrClear(root, "--sidebar-font-size",  px(sidebar.fontSize));
    if (sidebar.collapsedWidth != null) root.setProperty("--sidebar-collapsed", px(sidebar.collapsedWidth));
    if (sidebar.expandedWidth  != null) root.setProperty("--sidebar-expanded",  px(sidebar.expandedWidth));
    if (sidebar.iconSize       != null) root.setProperty("--sidebar-icon-size", px(sidebar.iconSize));

    const bottomText = theme.bottomText || {};
    setOrClear(root, "--bottom-text-color",     bottomText.textColor);
    setOrClear(root, "--bottom-text-font-size", px(bottomText.fontSize));

    const code = theme.code || {};
    setOrClear(root, "--md-inline-bg",       code.inlineBackgroundColor);
    setOrClear(root, "--md-inline-border",   code.inlineBorderColor);
    setOrClear(root, "--md-code-text",       code.textColor);
    setOrClear(root, "--md-block-bg",        code.blockBackgroundColor);
    setOrClear(root, "--md-block-border",    code.blockBorderColor);
    setOrClear(root, "--md-code-font-size",  px(code.fontSize));
}

async function loadTheme() {
    try {
        const res = await fetch(`${THEME_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`theme.json HTTP ${res.status}`);
        const data = await res.json();

        setFavicon(data.favicon);
        applyThemeVars(data.theme);
        applyThemeFonts(data.fonts);

        window.__SITE_THEME__ = data;
    } catch (err) {
        console.error("Theme: failed to load theme.json — falling back to defaults:", err);
    } finally {
        revealPage();
    }
}

loadTheme();