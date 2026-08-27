console.log("Theme module loaded");

const THEME_URL = "/config/theme.json";

// Shared fallback stack — matches the var() fallback baked directly into
// base.css/topbar.css/bottom-page.css, so JS-applied custom fonts degrade
// into the exact same stack instead of a bare "sans-serif" safety net.
const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

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

// ── Custom font handling (theme.page.font / theme.topbar.slogan.font /
// theme.bottomText.font, each falling back server-side to fonts.fallback if
// unset/invalid) ─────────────────────────────────────────────────────────────
//
// Each field is resolved server-side (lib/routes.js: resolveThemeFonts) to
// either null ("off" — no font-family CSS variable is set at all, so the
// matching CSS's own var() fallback — the system-ui stack, see base.css —
// applies instantly with zero flash) or { family, url, format } ("on" —
// inject a @font-face rule and set the CSS variable to that one font,
// chained in front of the same system-ui stack as a safety net in case the
// file fails to decode at runtime).

const FONT_VAR_MAP = {
    page:       "--page-font-family",
    slogan:     "--slogan-font-family",
    bottomText: "--bottom-text-font-family",
};

let _fontStyleEl = null;

function getFontStyleEl() {
    if (_fontStyleEl) return _fontStyleEl;
    _fontStyleEl = document.createElement("style");
    _fontStyleEl.id = "theme-custom-fonts";
    document.head.appendChild(_fontStyleEl);
    return _fontStyleEl;
}

function fontFaceRule(font) {
    return `@font-face { font-family: "${font.family}"; src: url("${font.url}") format("${font.format}"); font-display: swap; }`;
}

function applyThemeFonts(fonts) {
    const root  = document.documentElement.style;
    const rules = new Set(); // dedupe — fonts.fallback can be reused by 2-3 fields at once

    for (const [key, varName] of Object.entries(FONT_VAR_MAP)) {
        const font = fonts && fonts[key];
        if (font && font.family && font.url) {
            rules.add(fontFaceRule(font));
            root.setProperty(varName, `"${font.family}", ${SYSTEM_FONT_STACK}`);
        } else {
            // "Off" — explicitly clear any previously-set value (theme.json
            // is fetched fresh with no-store every load) so the matching
            // CSS's own var() fallback (system-ui stack) applies instead.
            root.removeProperty(varName);
        }
    }

    const styleEl  = getFontStyleEl();
    const combined = [...rules].join("\n");
    if (styleEl.textContent !== combined) styleEl.textContent = combined;
}

function applyThemeVars(theme) {
    if (!theme) return;
    const root = document.documentElement.style;

    if (theme.backgroundColor) root.setProperty("--bg", theme.backgroundColor);

    if (theme.page) {
        if (theme.page.textColor) root.setProperty("--page-text-color", theme.page.textColor);

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
        applyThemeFonts(data.fonts);

        // Exposed for other modules (e.g. topbar.js) that also need favicon/
        // slogan/theme data without a second fetch.
        window.__SITE_THEME__ = data;
    } catch (err) {
        console.error("Theme: failed to load theme.json:", err);
    }
}

// Runs immediately rather than waiting for DOMContentLoaded — fetching and
// setting a style property on document.documentElement doesn't require the
// full DOM tree, just <html> itself, which exists as soon as parsing
// starts. This shaves a bit more time off the window during which a
// configured custom font hasn't loaded yet (the "flash" for that case).
// The "no custom font configured" case no longer flashes at all — see the
// var() fallback chains added in base.css/topbar.css/bottom-page.css.
loadTheme();
