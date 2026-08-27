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

// ── Custom font handling (theme.page.font / theme.topbar.slogan.font /
// theme.bottomText.font, each falling back server-side to fonts.fallback if
// unset/invalid) ─────────────────────────────────────────────────────────────
//
// Each field is resolved server-side (lib/routes.js: resolveThemeFonts) to
// either null ("off" — no font-family CSS variable is set at all, so the
// matching CSS falls through to pure browser default) or
// { family, url, format } ("on" — inject a @font-face rule and set the CSS
// variable to exactly that one font + a "sans-serif" safety net, in case the
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
            root.setProperty(varName, `"${font.family}", sans-serif`);
        } else {
            // "Off" — explicitly clear any previously-set value (theme.json
            // is fetched fresh with no-store every load) so the matching CSS
            // falls through to pure browser default.
            root.removeProperty(varName);
        }
    }

    const styleEl  = getFontStyleEl();
    const combined = [...rules].join("\n");
    if (styleEl.textContent !== combined) styleEl.textContent = combined;
}

// ── Windows flag-emoji fix ────────────────────────────────────────────────
//
// Windows' built-in emoji font (Segoe UI Emoji) ships with zero flag
// glyphs. If /config/theme.json reports a resolved flagFont (i.e.
// config/master.json's fonts.flag path resolves to a real file on the
// server) AND this browser is running on Windows, register a @font-face
// scoped via unicode-range to *only* the flag emoji codepoints, then layer
// it in front of the page/slogan/bottom-text/chrome font stacks. If either
// condition isn't met, nothing is added — Windows renders flags exactly as
// it does today, no error, no visual change.

const FLAG_UNICODE_RANGE = "U+1F1E6-1F1FF, U+1F3F4, U+E0020-E007F, U+200D";

function isWindows() {
    return /Windows/i.test(navigator.userAgent || "");
}

let _flagStyleEl = null;

function getFlagStyleEl() {
    if (_flagStyleEl) return _flagStyleEl;
    _flagStyleEl = document.createElement("style");
    _flagStyleEl.id = "theme-flag-emoji-fix";
    document.head.appendChild(_flagStyleEl);
    return _flagStyleEl;
}

function applyFlagFontFix(flagFont) {
    if (!flagFont || !isWindows()) return;

    const styleEl = getFlagStyleEl();
    styleEl.textContent = `
@font-face {
    font-family: "${flagFont.family}";
    src: url("${flagFont.url}") format("${flagFont.format}");
    unicode-range: ${FLAG_UNICODE_RANGE};
    font-display: swap;
}

/* Layered in front of every existing font stack — page/slogan/bottom-text
   AND the fixed chrome fonts (topbar/sidebar/mobile-menu). Safe to prepend
   everywhere because unicode-range means this font is only ever actually
   used for the handful of flag codepoints above — every other character
   transparently falls through to whatever font would otherwise apply. */
html.os-windows-flags body {
    font-family: "${flagFont.family}", var(--page-font-family, sans-serif);
}
html.os-windows-flags .topbar-slogan {
    font-family: "${flagFont.family}", var(--slogan-font-family, sans-serif);
}
html.os-windows-flags .bottom-text {
    font-family: "${flagFont.family}", var(--bottom-text-font-family, var(--page-font-family, sans-serif));
}
html.os-windows-flags .topbar {
    font-family: "${flagFont.family}", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
html.os-windows-flags .sidebar {
    font-family: "${flagFont.family}", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
html.os-windows-flags .mobile-menu {
    font-family: "${flagFont.family}", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
}
`;

    document.documentElement.classList.add("os-windows-flags");
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
        applyFlagFontFix(data.flagFont);

        // Exposed for other modules (e.g. topbar.js) that also need favicon/
        // slogan/theme data without a second fetch.
        window.__SITE_THEME__ = data;
    } catch (err) {
        console.error("Theme: failed to load theme.json:", err);
    }
}

document.addEventListener("DOMContentLoaded", loadTheme);
