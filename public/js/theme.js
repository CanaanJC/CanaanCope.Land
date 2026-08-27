console.log("Theme module loaded");

const THEME_URL = "/config/theme.json";

// Shared fallback stack — matches the var() fallback baked directly into
// base.css/topbar.css/sidebar.css/bottom-page.css/lib-blog.css, so
// JS-applied custom fonts degrade into the exact same stack instead of a
// bare "sans-serif" safety net.
const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
const MONO_FONT_STACK   = '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace';

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

// ── Custom font handling ─────────────────────────────────────────────────────
//
// Server-resolved (lib/routes.js: buildThemePayload) into 6 independent
// slots, each either null ("off" — no font-family CSS variable is set at
// all, so the matching CSS's own var() fallback applies instantly with
// zero flash) or { family, url, format } ("on" — inject a @font-face rule
// and set the CSS variable to that one font, chained in front of the
// matching system/mono stack as a safety net in case the file fails to
// decode at runtime).

const FONT_VAR_MAP = {
    body:       { varName: "--page-font-family",        stack: SYSTEM_FONT_STACK },
    topbar:     { varName: "--topbar-font-family",       stack: SYSTEM_FONT_STACK },
    slogan:     { varName: "--slogan-font-family",       stack: SYSTEM_FONT_STACK },
    sidebar:    { varName: "--sidebar-font-family",      stack: SYSTEM_FONT_STACK },
    bottomText: { varName: "--bottom-text-font-family",  stack: SYSTEM_FONT_STACK },
    code:       { varName: "--md-code-font-family",      stack: MONO_FONT_STACK },
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
    const rules = new Set(); // dedupe — shared font paths can produce identical @font-face bodies

    for (const [key, cfg] of Object.entries(FONT_VAR_MAP)) {
        const font = fonts && fonts[key];
        if (font && font.family && font.url) {
            rules.add(fontFaceRule(font));
            root.setProperty(cfg.varName, `"${font.family}", ${cfg.stack}`);
        } else {
            // "Off" — explicitly clear any previously-set value (theme.json
            // is fetched fresh with no-store every load) so the matching
            // CSS's own var() fallback applies instead.
            root.removeProperty(cfg.varName);
        }
    }

    const styleEl  = getFontStyleEl();
    const combined = [...rules].join("\n");
    if (styleEl.textContent !== combined) styleEl.textContent = combined;
}

// ── Color / size variables — theme.js just applies whatever the server
// already resolved (each section's backgroundColor/fontSize/textColor has
// already fallen back to theme.master's equivalent field server-side where
// left empty) — no further fallback logic needed here. ──────────────────────

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
    setOrClear(root, "--bg",               body.backgroundColor);
    setOrClear(root, "--page-text-color",  body.textColor);
    setOrClear(root, "--page-font-size",   px(body.fontSize));

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
    setOrClear(root, "--bottom-text-bg",        bottomText.backgroundColor);
    setOrClear(root, "--bottom-text-color",     bottomText.textColor);
    setOrClear(root, "--bottom-text-font-size", px(bottomText.fontSize));

    const code = theme.code || {};
    setOrClear(root, "--md-code-bg",          code.backgroundColor);
    setOrClear(root, "--md-code-border",      code.borderColor);
    setOrClear(root, "--md-code-text",        code.textColor);
    setOrClear(root, "--md-block-bg",         code.blockBackgroundColor);
    setOrClear(root, "--md-block-border",     code.blockBorderColor);
    setOrClear(root, "--md-code-font-size",   px(code.fontSize));
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
// The "no custom font configured" case doesn't flash at all — see the
// var() fallback chains in base.css/topbar.css/sidebar.css/bottom-page.css/
// lib-blog.css.
loadTheme();
