const DEFAULT_MOBILE_RATIO = "9:16";
const DEFAULT_ICON_SIZE = 64;
const DEFAULT_TEXT_SIZE = 12;
const DEFAULT_SIDEBAR_WIDTH = 340;

export function parseAspectRatio(raw) {
    if (typeof raw !== "string") return null;
    const parts = raw.split(":");
    if (parts.length !== 2) return null;

    const w = parseFloat(parts[0].trim());
    const h = parseFloat(parts[1].trim());
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

    return `${w} / ${h}`;
}

function toPixels(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
        const n = parseFloat(value.trim());
        if (Number.isFinite(n) && n > 0) return n;
    }
    return fallback;
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

    const iconSize = toPixels(mediaDisplay.iconSize, DEFAULT_ICON_SIZE);
    const textSize = toPixels(mediaDisplay.textSize, DEFAULT_TEXT_SIZE);
    const tileWidth = Math.max(iconSize + 20, 56);

    root.style.setProperty("--media-icon-size", `${iconSize}px`);
    root.style.setProperty("--media-text-size", `${textSize}px`);
    root.style.setProperty("--media-tile-width", `${tileWidth}px`);

    const sidebarWidth = toPixels(layout.sidebarWidth, DEFAULT_SIDEBAR_WIDTH);
    root.style.setProperty("--lib-sidebar-width", `${sidebarWidth}px`);

    const ratio = parseAspectRatio(previewCfg.mobileAspectRatio) || parseAspectRatio(DEFAULT_MOBILE_RATIO);
    root.style.setProperty("--preview-mobile-ratio", ratio);

    _loaded = {
        tags,
        stlDefaults,
        mediaDisplay: { ...mediaDisplay, iconSize, textSize },
        layout: { ...layout, sidebarWidth },
        preview: previewCfg,
    };
    return _loaded;
}

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
