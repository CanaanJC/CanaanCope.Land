const GOOGLE_FONT_PREFIX = "google-font:";

const AXIS_RE = /^[A-Za-z0-9]{4}$/;
const DISPLAY_MODES = new Set(["swap", "auto", "block", "fallback", "optional"]);

function formatAxisValue(value) {
    const rounded = Number(value.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function isGoogleFont(value) {
    return typeof value === "string" && value.trim().startsWith(GOOGLE_FONT_PREFIX);
}

function parseGoogleFont(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text.startsWith(GOOGLE_FONT_PREFIX)) return null;

    try {
        const rest  = text.slice(GOOGLE_FONT_PREFIX.length);
        const index = rest.indexOf("?");
        const family = decodeURIComponent(index === -1 ? rest : rest.slice(0, index)).trim();

        if (!family) return null;
        if (family.length > 100) return null;
        if (/["'\\<>;{}]/.test(family)) return null;

        const params = new URLSearchParams(index === -1 ? "" : rest.slice(index + 1));
        const axes = {};

        for (const [tag, raw] of params) {
            if (!AXIS_RE.test(tag)) continue;
            if (typeof raw !== "string" || raw.trim() === "") continue;
            const num = Number(raw);
            if (!Number.isFinite(num)) continue;
            axes[tag] = tag === "ital" ? (num >= 0.5 ? 1 : 0) : num;
        }

        const display = params.get("display");

        return {
            family,
            axes,
            display: DISPLAY_MODES.has(display) ? display : "swap",
        };
    } catch {
        return null;
    }
}

function googleFontStylesheetUrl(descriptor) {
    if (!descriptor || typeof descriptor.family !== "string" || descriptor.family.trim() === "") return null;

    const axes = descriptor.axes || {};
    const tags = Object.keys(axes).filter(tag => AXIS_RE.test(tag) && Number.isFinite(axes[tag]));

    const lower   = tags.filter(tag => tag === tag.toLowerCase()).sort();
    const upper   = tags.filter(tag => tag !== tag.toLowerCase()).sort();
    const ordered = [...lower, ...upper];

    let spec = encodeURIComponent(descriptor.family).replace(/%20/g, "+");

    if (ordered.length) {
        const values = ordered.map(tag => formatAxisValue(axes[tag]));
        spec += `:${ordered.join(",")}@${values.join(",")}`;
    }

    const display = DISPLAY_MODES.has(descriptor.display) ? descriptor.display : "swap";
    return `https://fonts.googleapis.com/css2?family=${spec}&display=${display}`;
}

function googleFontVariationSettings(descriptor) {
    const axes = (descriptor && descriptor.axes) || {};
    const entries = Object.keys(axes)
        .filter(tag => AXIS_RE.test(tag) && tag !== "ital" && tag !== "wght" && Number.isFinite(axes[tag]))
        .sort()
        .map(tag => `"${tag}" ${formatAxisValue(axes[tag])}`);
    return entries.length ? entries.join(", ") : null;
}

function googleFontWeight(descriptor) {
    const axes = (descriptor && descriptor.axes) || {};
    return Number.isFinite(axes.wght) ? formatAxisValue(axes.wght) : null;
}

function googleFontStyle(descriptor) {
    const axes = (descriptor && descriptor.axes) || {};
    return Number.isFinite(axes.ital) && axes.ital >= 0.5 ? "italic" : null;
}

module.exports = {
    GOOGLE_FONT_PREFIX,
    isGoogleFont,
    parseGoogleFont,
    googleFontStylesheetUrl,
    googleFontVariationSettings,
    googleFontWeight,
    googleFontStyle,
};