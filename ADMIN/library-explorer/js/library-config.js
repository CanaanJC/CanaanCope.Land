// ─────────────────────────────────────────────────────────────────────────────
// Loads ADMIN/library-explorer/library.json and injects it as CSS custom
// properties:
//   - --tag-color-<key>       for every entry under "tags"      (highlight.css)
//   - --media-icon-size       from mediaDisplay.iconSize (px)   (media.css)
//   - --media-text-size       from mediaDisplay.textSize (px)   (media.css)
//   - --lib-sidebar-width     from layout.sidebarWidth (px)     (browser.css)
//   - --preview-mobile-ratio  from preview.mobileAspectRatio    (preview.css)
//
// Also exposes the raw loaded sections (getTagColors / getStlDefaults /
// getMediaDisplay / getLayout / getPreviewConfig) so other modules can pull
// values directly from library.json instead of ever hardcoding them.
//
// Falls back silently (CSS's own :root defaults apply) if library.json is
// missing or invalid.
// ─────────────────────────────────────────────────────────────────────────────

// Default used whenever preview.mobileAspectRatio is missing/unparseable.
const DEFAULT_MOBILE_RATIO = "9:16";

// Parses an "X:Y" string into a CSS aspect-ratio value ("X / Y"). Returns
// null for anything that isn't two positive finite numbers separated by a
// colon — the caller falls back to DEFAULT_MOBILE_RATIO.
export function parseAspectRatio(raw) {
    if (typeof raw !== "string") return null;
    const parts = raw.split(":");
    if (parts.length !== 2) return null;

    const w = parseFloat(parts[0].trim());
    const h = parseFloat(parts[1].trim());
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

    return `${w} / ${h}`;
}

let _loaded = null;

export async function loadBlogConfig() {
    if (_loaded) return _loaded;

    let config = {};
    try {
        const res = await fetch("/library-explorer/library.json");
        if (res.ok) config = await res.json();
    } catch {
        config = {};
    }

    const tags         = (config && config.tags) || {};
    const stlDefaults  = (config && config.stlDefaults) || {};
    const mediaDisplay = (config && config.mediaDisplay) || {};
    const layout       = (config && config.layout) || {};
    const previewCfg   = (config && config.preview) || {};

    const root = document.documentElement;

    for (const [key, value] of Object.entries(tags)) {
        if (typeof value === "string" && value.trim()) {
            root.style.setProperty(`--tag-color-${key}`, value.trim());
        }
    }

    if (typeof mediaDisplay.iconSize === "number") {
        root.style.setProperty("--media-icon-size", `${mediaDisplay.iconSize}px`);
    }
    if (typeof mediaDisplay.textSize === "number") {
        root.style.setProperty("--media-text-size", `${mediaDisplay.textSize}px`);
    }
    if (typeof layout.sidebarWidth === "number") {
        root.style.setProperty("--lib-sidebar-width", `${layout.sidebarWidth}px`);
    }

    // Mobile preview frame shape — always set, so a malformed/missing value
    // still lands on a sane portrait default rather than collapsing the
    // frame entirely.
    const ratio = parseAspectRatio(previewCfg.mobileAspectRatio) || parseAspectRatio(DEFAULT_MOBILE_RATIO);
    root.style.setProperty("--preview-mobile-ratio", ratio);

    _loaded = { tags, stlDefaults, mediaDisplay, layout, preview: previewCfg };
    return _loaded;
}

// Safe to call synchronously any time after boot() has kicked off
// loadBlogConfig() — callers that need to guarantee it's loaded first
// should await loadBlogConfig() themselves.
export function getTagColors() {
    return (_loaded && _loaded.tags) || {};
}

export function getStlDefaults() {
    return (_loaded && _loaded.stlDefaults) || {};
}

export function getMediaDisplay() {
    return (_loaded && _loaded.mediaDisplay) || {};
}

export function getLayout() {
    return (_loaded && _loaded.layout) || {};
}

export function getPreviewConfig() {
    return (_loaded && _loaded.preview) || {};
}
