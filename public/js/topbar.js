console.log("Topbar module loaded");

const DATA_URL      = "./json/topbar.json";
const LIBRARIES_URL = "/config/libraries.json";
const THEME_URL     = "/config/theme.json";

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

function createLogo(src) {
    const a = document.createElement("a");
    a.className = "topbar-logo";
    a.href = "/";

    const img = document.createElement("img");
    img.className = "topbar-logo__img";
    img.alt = "Site logo";
    img.src = src || FALLBACK_ICON;
    img.addEventListener("error", () => {
        img.src = FALLBACK_ICON;
        img.classList.add("fallback");
    });

    a.appendChild(img);
    return a;
}

function createLibrariesDropdown(title, libraries) {
    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";
    wrapper.id = "libraries-nav-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = title;

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const lib of libraries) {
        const a = document.createElement("a");
        a.className = "topbar-dropdown__item topbar-dropdown__item--library";
        a.href = `/${lib.path}`;

        const iconSlot = document.createElement("span");
        iconSlot.className = "topbar-dropdown__icon-slot";

        if (lib.icon && typeof lib.icon === "string" && lib.icon.trim() !== "") {
            const img = document.createElement("img");
            img.className = "topbar-dropdown__icon";
            img.alt = lib.name || "";
            img.src = lib.icon;
            img.addEventListener("error", () => {
                img.src = FALLBACK_ICON;
                img.classList.add("fallback");
            });
            iconSlot.appendChild(img);
        }

        const name = document.createElement("span");
        name.className = "topbar-dropdown__name";
        name.textContent = lib.name || lib.path;

        a.appendChild(iconSlot);
        a.appendChild(name);
        menu.appendChild(a);
    }

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    wrapper.addEventListener("mouseenter", () => wrapper.classList.add("open"));
    wrapper.addEventListener("mouseleave", () => wrapper.classList.remove("open"));

    return wrapper;
}

async function loadLibrariesDropdown(container, title) {
    try {
        const res = await fetch(`${LIBRARIES_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`libraries.json HTTP ${res.status}`);
        const allLibraries = await res.json();
        if (!Array.isArray(allLibraries) || allLibraries.length === 0) {
            console.warn("Topbar: libraries.json returned no libraries — dropdown skipped.");
            return;
        }

        const visibleLibraries = allLibraries.filter(lib => !lib.hidden);
        if (visibleLibraries.length === 0) {
            console.warn("Topbar: all libraries are hidden — dropdown skipped.");
            return;
        }

        container.appendChild(createLibrariesDropdown(title, visibleLibraries));
    } catch (err) {
        console.error("Topbar: failed to load libraries dropdown:", err);
    }
}

function createSlogan(text) {
    const span = document.createElement("span");
    span.className = "topbar-slogan";
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/ /g, "&nbsp;");
    span.innerHTML = escaped;
    return span;
}

async function loadTopbar() {
    const container = document.getElementById("topbarList");
    if (!container) return;

    try {
        const [topbarRes, themeRes] = await Promise.all([
            fetch(`${DATA_URL}?_=${Date.now()}`,  { cache: "no-store" }),
            fetch(`${THEME_URL}?_=${Date.now()}`, { cache: "no-store" }),
        ]);

        const data      = topbarRes.ok ? await topbarRes.json() : {};
        const themeData = themeRes.ok  ? await themeRes.json()  : {};

        container.innerHTML = "";

        const icon = themeData?.theme?.topbar?.icon || "";
        container.appendChild(createLogo(icon));

        await loadLibrariesDropdown(container, data.librariesDropdownTitle || "Projects");

        const hasOverride = typeof data.sloganOverride === "string" && data.sloganOverride.trim() !== "";
        const slogan = hasOverride ? data.sloganOverride : (themeData.slogan || "");
        if (slogan) container.appendChild(createSlogan(slogan));

    } catch (err) {
        console.error("Topbar load failed:", err);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadTopbar();
    window.__TOPBAR_READY__ = true;
    document.dispatchEvent(new CustomEvent("topbar:ready"));
});
