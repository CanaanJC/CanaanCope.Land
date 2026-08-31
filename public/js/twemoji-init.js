
console.log("Twemoji module loaded");

const WINDOWS_ONLY = false; // ← flip to false to test on macOS locally

function isWindows() {
    return /Windows/i.test(navigator.userAgent || "");
}

function shouldRun() {
    return !WINDOWS_ONLY || isWindows();
}

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

function parseWholePage() {
    parseNode(document.body);
}

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
