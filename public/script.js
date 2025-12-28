console.log("JS build v=dev4 loaded");

// Human-readable setting: how many pixels the sidebar expands to
// Change this value to control the expansion width.
const SIDEBAR_EXPANDED_PX = 320;

// Data source for links
const DATA_URL = "./links.json";

// Fallback icon (unchanged)
const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

// Remove any legacy status node ASAP (in case of cached HTML or old JS side-effects)
(function killLegacyStatusEarly() {
    const n = document.getElementById("sidebarStatus");
    if (n && n.parentNode) n.parentNode.removeChild(n);
})();

function createSidebarItem(item) {
    const a = document.createElement("a");
    a.className = "sidebar-item";
    a.href = item.link;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = item.text;

    const img = document.createElement("img");
    img.className = "sidebar-item__icon";
    img.alt = item.text || "link";
    const candidate = item.image && typeof item.image === "string" ? item.image : "";
    img.src = candidate || FALLBACK_ICON;
    img.addEventListener("error", () => {
        if (img.src !== FALLBACK_ICON) {
            img.src = FALLBACK_ICON;
            img.classList.add("fallback");
        }
    });

    const span = document.createElement("span");
    span.className = "sidebar-item__text";
    span.textContent = item.text || "Untitled";

    a.appendChild(img);
    a.appendChild(span);
    return a;
}

async function loadSidebar() {
    const container = document.getElementById("sidebarList");

    // Remove any leftover status node again at runtime
    const legacyStatus = document.getElementById("sidebarStatus");
    if (legacyStatus && legacyStatus.parentNode) {
        legacyStatus.parentNode.removeChild(legacyStatus);
    }

    try {
        // Strong cache-bust and no-store to avoid stale or blocked caches
        const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`links.json HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Invalid links.json: expected array");

        container.innerHTML = "";
        for (const item of data) {
            if (!item || !item.link) continue;
            container.appendChild(createSidebarItem(item));
        }
    } catch (err) {
        console.error("Sidebar load failed:", err);
    }
}

function applyExpandedWidth() {
    // Sync human-readable JS setting into CSS variable
    document.documentElement.style.setProperty("--sidebar-expanded", `${SIDEBAR_EXPANDED_PX}px`);
}

document.addEventListener("DOMContentLoaded", async () => {
    applyExpandedWidth();
    await loadSidebar();
});
