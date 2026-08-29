// ─────────────────────────────────────────────────────────────────────────────
// Loads ADMIN/blog-editor/tags.json and injects its colors as CSS custom
// properties (--tag-color-<key>) so highlight.css's .tag-* classes always
// reflect whatever's configured, without any hardcoded colors in JS.
// Falls back silently (CSS's own :root defaults apply) if tags.json is
// missing or invalid.
//
// Also exposes the raw loaded colors (getTagColors) so other modules (e.g.
// js/toolbar.js) can pull colors directly from tags.json instead of ever
// hardcoding them.
// ─────────────────────────────────────────────────────────────────────────────

let _loaded = null;

export async function loadTagColors() {
    if (_loaded) return _loaded;

    let colors = {};
    try {
        const res = await fetch("/blog-editor/tags.json");
        if (res.ok) colors = await res.json();
    } catch {
        colors = {};
    }

    const root = document.documentElement;
    for (const [key, value] of Object.entries(colors)) {
        if (typeof value === "string" && value.trim()) {
            root.style.setProperty(`--tag-color-${key}`, value.trim());
        }
    }

    _loaded = colors;
    return colors;
}

// Returns the already-loaded colors object (or {} if loadTagColors() hasn't
// resolved yet). Safe to call synchronously any time after boot() has
// kicked off loadTagColors() — callers that need to guarantee it's loaded
// first should await loadTagColors() themselves.
export function getTagColors() {
    return _loaded || {};
}
