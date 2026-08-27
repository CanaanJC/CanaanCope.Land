// ─────────────────────────────────────────────────────────────────────────────
// twemoji-init.js — controls Twemoji-based emoji replacement (flags, etc.)
//
// Loads the Twemoji parser (via a plain <script> CDN tag placed in each HTML
// page, ahead of this module) and walks the page replacing emoji characters
// with inline Twemoji SVGs. If Twemoji fails to load or parse for any
// reason, nothing is touched and the browser's native glyphs are shown
// exactly as before — there is no scenario where this file can make emoji
// disappear or break the page.
//
// WINDOWS_ONLY below is the single switch controlling where this runs:
//   - true  (default/production) — only runs on Windows, since Windows is
//     the only platform missing color flag glyphs in its system emoji font.
//     macOS/iOS/Android/Linux all render flags natively already, so nothing
//     happens there and native glyphs are shown as-is.
//   - false — runs on EVERY platform, including macOS. Flip this locally
//     while testing on a Mac so you can see the Twemoji replacement working
//     without needing an actual Windows machine. Set it back to true before
//     shipping.
// ─────────────────────────────────────────────────────────────────────────────

console.log("Twemoji module loaded");

const WINDOWS_ONLY = true; // ← flip to false to test on macOS locally

function isWindows() {
    return /Windows/i.test(navigator.userAgent || "");
}

function shouldRun() {
    return !WINDOWS_ONLY || isWindows();
}

// Twemoji's own parse() call. Wrapped in try/catch — if anything about the
// CDN library ever misbehaves, this fails silently and the page just keeps
// showing native glyphs (the fallback the task asked for).
function parseNode(node) {
    if (!window.twemoji || !node) return;
    try {
        window.twemoji.parse(node, {
            folder: "svg",
            ext: ".svg",
            className: "twemoji-emoji",
        });
    } catch (err) {
        console.error("Twemoji: parse failed — falling back to native glyphs:", err);
    }
}

// Re-parses the whole page. Safe to call repeatedly — twemoji.parse()
// skips text nodes it has already converted into <img> tags.
function parseWholePage() {
    parseNode(document.body);
}

// Watches for new content being added anywhere in the page (lazy-loaded
// blog entries, mobile menu population, topbar/sidebar injection, gallery
// modals, etc.) and re-parses just enough to catch it. This is what makes
// emoji in content that loads AFTER first paint (most of this site's
// content is fetched async) still get converted.
function observeForNewContent() {
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 || node.nodeType === 3) {
                        parseNode(node.nodeType === 1 ? node : node.parentNode);
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return observer;
}

function init() {
    if (!shouldRun()) {
        console.log("Twemoji: skipped (not Windows, and WINDOWS_ONLY is true).");
        return;
    }

    if (!window.twemoji) {
        console.error("Twemoji: library not found on window — falling back to native glyphs. " +
            "Check that the Twemoji CDN <script> tag loaded before this module.");
        return;
    }

    parseWholePage();
    observeForNewContent();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
