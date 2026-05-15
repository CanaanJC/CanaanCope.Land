console.log("Sidebar module loaded");

const DATA_URL = "./json/sidebar.json";

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

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
    if (!container) return;

    try {
        const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`sidebar.json HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Invalid sidebar.json: expected array");

        container.innerHTML = "";
        const frag = document.createDocumentFragment();
        for (const item of data) {
            if (!item || !item.link) continue;
            frag.appendChild(createSidebarItem(item));
        }
        container.appendChild(frag);

        calculateSidebarWidth();
        setupSidebarToggle();

        document.querySelector(".sidebar")?.classList.remove("sidebar--loading");
    } catch (err) {
        console.error("Sidebar load failed:", err);
    }
}

function calculateSidebarWidth() {
    const sidebar = document.querySelector(".sidebar");
    const items = document.querySelectorAll(".sidebar-item");
    if (!sidebar || items.length === 0) return;

    sidebar.classList.add("measuring");
    
    let maxWidth = 0;
    items.forEach(item => {
        const width = item.scrollWidth;
        if (width > maxWidth) maxWidth = width;
    });

    const padding = 32;
    const expandedWidth = maxWidth + padding;
    
    document.documentElement.style.setProperty("--sidebar-expanded", `${expandedWidth}px`);
    
    sidebar.classList.remove("measuring");
}

function setupSidebarToggle() {
    const sidebar = document.querySelector(".sidebar");
    const sidebarInner = document.querySelector(".sidebar-inner");
    if (!sidebar || !sidebarInner) return;

    sidebarInner.addEventListener("click", (e) => {
        const clickedItem = e.target.closest(".sidebar-item");
        const clickedIcon = e.target.classList.contains("sidebar-item__icon");

        if (clickedIcon) {
            return;
        }

        if (clickedItem) {
            e.preventDefault();
            sidebar.classList.toggle("expanded");
            return;
        }

        sidebar.classList.toggle("expanded");
    });

    document.addEventListener("click", (e) => {
        if (!sidebar.contains(e.target) && sidebar.classList.contains("expanded")) {
            sidebar.classList.remove("expanded");
        }
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadSidebar();
});