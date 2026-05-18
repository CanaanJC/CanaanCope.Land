import { loadMarked, buildRows } from "./lib-blog.js";

console.log("About-me module loaded");

if (window.location.pathname !== "/") {
    throw new Error("[about-me.js] Not the homepage, halting module.");
}

const MEDIA_BASE   = "/media/about-me";
const LISTING_BASE = "/about-me/media-listing";

async function loadAboutMe() {
    const container = document.getElementById("content");
    if (!container) return;

    await loadMarked();

    let rawMd;
    try {
        const res = await fetch(`/about-me.md?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`about-me.md HTTP ${res.status}`);
        rawMd = await res.text();
    } catch (err) {
        console.error("Failed to load about-me.md:", err);
        return;
    }

    const wrapper = document.createElement("div");
    wrapper.id = "about-me-content";
    wrapper.appendChild(buildRows(rawMd, MEDIA_BASE, LISTING_BASE));
    container.appendChild(wrapper);
}

document.addEventListener("DOMContentLoaded", () => {
    loadAboutMe();
});
