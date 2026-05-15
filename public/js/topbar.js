console.log("Topbar module loaded");

const DATA_URL = "./json/topbar.json";

const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

function resolveHref(link) {
    if (!link) return "#";
    return link;
}

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

function createDropdown(dropdown) {
    const wrapper = document.createElement("div");
    wrapper.className = "topbar-dropdown";

    const trigger = document.createElement("span");
    trigger.className = "topbar-dropdown__trigger";
    trigger.textContent = dropdown.title;

    const menu = document.createElement("div");
    menu.className = "topbar-dropdown__menu";

    for (const item of dropdown.items) {
        const a = document.createElement("a");
        a.className = "topbar-dropdown__item";
        a.href = resolveHref(item.link);
        if (item.link && item.link.startsWith("http")) {
            a.target = "_blank";
            a.rel = "noopener noreferrer";
        }

        const iconSlot = document.createElement("span");
        iconSlot.className = "topbar-dropdown__icon-slot";

        if (item.icon && typeof item.icon === "string" && item.icon.trim() !== "") {
            const img = document.createElement("img");
            img.className = "topbar-dropdown__icon";
            img.alt = item.name || "";
            img.src = item.icon;
            img.addEventListener("error", () => {
                img.src = FALLBACK_ICON;
                img.classList.add("fallback");
            });
            iconSlot.appendChild(img);
        }

        const name = document.createElement("span");
        name.className = "topbar-dropdown__name";
        name.textContent = item.name || "Untitled";

        a.appendChild(iconSlot);
        a.appendChild(name);
        menu.appendChild(a);
    }

    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    wrapper.addEventListener("mouseenter", () => {
        wrapper.classList.add("open");
    });
    wrapper.addEventListener("mouseleave", () => {
        wrapper.classList.remove("open");
    });

    return wrapper;
}

function createSlogan(text) {
    const span = document.createElement("span");
    span.className = "topbar-slogan";
    // Use innerHTML with escaped text so the browser preserves
    // all literal spaces from the JSON string without collapsing them
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
        const res = await fetch(`${DATA_URL}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`topbar.json HTTP ${res.status}`);
        const data = await res.json();

        container.innerHTML = "";

        if (data.logo) {
            container.appendChild(createLogo(data.logo));
        }

        if (Array.isArray(data.dropdowns)) {
            for (const dropdown of data.dropdowns) {
                container.appendChild(createDropdown(dropdown));
            }
        }

        if (data.slogan) {
            container.appendChild(createSlogan(data.slogan));
        }

    } catch (err) {
        console.error("Topbar load failed:", err);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadTopbar();
});