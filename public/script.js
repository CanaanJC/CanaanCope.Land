console.log("JS build v=dev7 loaded");

const SIDEBAR_EXPANDED_PX = 320;
const DATA_URL = "./json/links.json";       // moved into /json
const TOPBAR_DATA_URL = "./json/topbar.json"; // renamed to topbar.json

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

(function killLegacyStatusEarly() {
    const n = document.getElementById("sidebarStatus");
    if (n && n.parentNode) n.parentNode.removeChild(n);
})();

/* ---------- Sidebar ---------- */
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
    const legacyStatus = document.getElementById("sidebarStatus");
    if (legacyStatus && legacyStatus.parentNode) {
        legacyStatus.parentNode.removeChild(legacyStatus);
    }

    try {
        const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`links.json HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Invalid links.json: expected array");

        container.innerHTML = "";
        const frag = document.createDocumentFragment();
        for (const item of data) {
            if (!item || !item.link) continue;
            frag.appendChild(createSidebarItem(item));
        }
        container.appendChild(frag);
    } catch (err) {
        console.error("Sidebar load failed:", err);
    }
}

function applyExpandedWidth() {
    document.documentElement.style.setProperty("--sidebar-expanded", `${SIDEBAR_EXPANDED_PX}px`);
}

/* ---------- Mobile detection and sticky toggle behavior ---------- */
function isMobileLike() {
    const noHover = window.matchMedia("(hover: none)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    return noHover && coarse;
}

function setupMobileStickySidebar() {
    const sidebar = document.querySelector(".sidebar");
    const inner = document.querySelector(".sidebar-inner");
    if (!sidebar || !inner) return;

    const toggleLayer = document.createElement("div");
    toggleLayer.className = "sidebar-toggle-layer";
    sidebar.appendChild(toggleLayer);

    const isOpen = () => sidebar.classList.contains("is-open");
    const setOpen = (open) => {
        sidebar.classList.toggle("is-open", open);
        sidebar.setAttribute("aria-expanded", String(open));
    };

    let downX = 0, downY = 0;
    const isTap = (e) => {
        const dx = Math.abs(e.clientX - downX);
        const dy = Math.abs(e.clientY - downY);
        return dx + dy <= 6;
    };

    sidebar.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        downX = e.clientX;
        downY = e.clientY;
    });

    toggleLayer.addEventListener("pointerup", (e) => {
        if (!isTap(e)) return;
        setOpen(!isOpen());
    });

    inner.addEventListener("pointerup", (e) => {
        if (!isTap(e)) return;
        const link = e.target.closest("a.sidebar-item");
        if (link) return;
        setOpen(!isOpen());
    });

    sidebar.setAttribute("tabindex", "0");
    sidebar.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!isOpen());
        }
    });

    const updateForEnvChange = () => {
        if (!isMobileLike()) {
            setOpen(false);
        }
    };
    [ "(hover: none)", "(pointer: coarse)" ].forEach(q =>
        window.matchMedia(q).addEventListener("change", updateForEnvChange)
    );
    window.addEventListener("resize", updateForEnvChange, { passive: true });
}

/* ---------- Topbar ---------- */
function createTopbarItem(item) {
    const btn = document.createElement("a");
    btn.className = "topbar-item";
    // Build clean path from slug-like link in JSON
    // If item.link starts with '/', keep it. Else prefix with '/'
    if (item.link && typeof item.link === "string") {
        btn.href = item.link.startsWith("/") ? item.link : `/${item.link}`;
    } else {
        btn.href = "#";
    }
    btn.title = item.text || "";
    btn.setAttribute("role", "button");

    if (item.image && typeof item.image === "string" && item.image.trim() !== "") {
        const img = document.createElement("img");
        img.className = "topbar-item__icon";
        img.alt = item.text || "icon";
        img.src = item.image;
        img.addEventListener("error", () => {
            if (img.src !== FALLBACK_ICON) {
                img.src = FALLBACK_ICON;
                img.classList.add("fallback");
            }
        });
        btn.appendChild(img);
    }

    const span = document.createElement("span");
    span.textContent = item.text || "Item";
    btn.appendChild(span);

    return btn;
}

async function loadTopbar() {
    const container = document.getElementById("topbarList");
    if (!container) return;

    try {
        const res = await fetch(`${TOPBAR_DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`topbar.json HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Invalid topbar.json: expected array");

        container.innerHTML = "";
        const frag = document.createDocumentFragment();
        for (const item of data) {
            if (!item || !item.text) continue;
            frag.appendChild(createTopbarItem(item));
        }
        container.appendChild(frag);
        document.body.classList.add("has-topbar");
    } catch (err) {
        console.error("Topbar load failed:", err);
        document.body.classList.add("has-topbar");
    }
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", async () => {
    applyExpandedWidth();
    document.body.classList.add("has-topbar");
    await Promise.all([ loadTopbar(), loadSidebar() ]);
    if (isMobileLike()) setupMobileStickySidebar();
});
