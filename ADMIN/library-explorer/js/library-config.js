// ─────────────────────────────────────────────────────────────────────────────
// Loads ADMIN/library-explorer/library.json and injects it as CSS custom properties:
//   - --tag-color-<key>    for every entry under "tags"       (highlight.css)
//   - --media-icon-size    from mediaDisplay.iconSize (px)    (media.css)
//   - --media-text-size    from mediaDisplay.textSize (px)    (media.css)
//   - --lib-sidebar-width  from layout.sidebarWidth (px)      (browser.css)
//
// Also exposes the raw loaded sections (getTagColors / getStlDefaults /
// getMediaDisplay / getLayout) so other modules (toolbar.js,
// media-manager.js, library-browser.js) can pull values directly from
// blog.json instead of ever hardcoding them.
//
// Falls back silently (CSS's own :root defaults apply) if blog.json is
// missing or invalid.
// ─────────────────────────────────────────────────────────────────────────────

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

    const tags          = (config && config.tags) || {};
    const stlDefaults    = (config && config.stlDefaults) || {};
    const mediaDisplay   = (config && config.mediaDisplay) || {};
    const layout         = (config && config.layout) || {};

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

    _loaded = { tags, stlDefaults, mediaDisplay, layout };
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
