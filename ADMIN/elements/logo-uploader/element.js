// ADMIN/elements/logo-uploader/element.js

// Inline fallback icon — same shape used on the public site (topbar.js /
// sidebar.js) for missing images. Shown only if NEITHER the public site
// address NOR the local hosting address can actually load media/logo.png.
const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

// Off-DOM probe — never touches the visible <img>, so a failed candidate
// can never leave the preview in a broken/placeholder state by accident.
function tryLoadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = url;
        // Generous timeout — slow DNS/first-hit AVIF-variant builds on the
        // server shouldn't be mistaken for "logo doesn't exist".
        setTimeout(() => finish(false), 8000);
    });
}

export default function init(root) {
    const preview   = root.querySelector("#lu-preview");
    const fileIn    = root.querySelector("#lu-file");
    const chooseBtn = root.querySelector("#lu-choose");
    const statusEl  = root.querySelector("#lu-status");

    // Populated once from /api/site-info + /api/config, then reused for
    // every refresh (including after a fresh upload).
    let baseCandidates = [];

    function showFallback() {
        preview.src = FALLBACK_ICON;
        preview.classList.add("admin-logo-preview--fallback");
    }

    function showReal(url) {
        preview.classList.remove("admin-logo-preview--fallback");
        preview.src = url;
    }

    // Show the fallback immediately so there's never a broken-image icon
    // while candidates are still being probed.
    showFallback();

    // Tries every known base (public siteAddress, then the local
    // hostname:port this admin page is itself being served alongside) in
    // order, cache-busted so an upload is never masked by browser/HTTP
    // caching. Only falls back to the placeholder if NONE of them load —
    // a single unreachable domain can no longer permanently hide a real,
    // successfully-uploaded logo.
    async function refreshPreview() {
        const bust = Date.now();
        for (const base of baseCandidates) {
            if (!base) continue;
            const url = `${base}/media/logo.png?t=${bust}`;
            const ok = await tryLoadImage(url);
            if (ok) {
                showReal(url);
                return;
            }
        }
        showFallback();
    }

    Promise.all([
        fetch("/api/site-info").then(r => r.json()).catch(() => ({})),
        fetch("/api/config").then(r => r.json()).catch(() => ({})),
    ])
        .then(([siteInfo, config]) => {
            const candidates = [];
            if (siteInfo && siteInfo.siteAddress) {
                candidates.push(siteInfo.siteAddress.replace(/\/$/, ""));
            }
            const port = config && config.hosting && config.hosting.port;
            if (port) {
                candidates.push(`http://${window.location.hostname}:${port}`);
            }
            baseCandidates = candidates;
            return refreshPreview();
        })
        .catch((e) => {
            statusEl.textContent = `Failed to load site info: ${e.message}`;
            statusEl.className = "admin-status admin-status--error";
        });

    chooseBtn.addEventListener("click", () => fileIn.click());

    fileIn.addEventListener("change", () => {
        const file = fileIn.files[0];
        fileIn.value = "";
        if (!file) return;

        if (!confirm("This will overwrite the live logo.png — continue?")) return;

        statusEl.textContent = "Uploading…";
        statusEl.className = "admin-status";

        file.arrayBuffer()
            .then((buf) => fetch("/api/logo", {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: buf,
            }))
            .then(r => r.json())
            .then((res) => {
                if (res.error) throw new Error(res.error);
                statusEl.textContent = "Logo updated.";
                statusEl.className = "admin-status admin-status--ok";
                return refreshPreview();
            })
            .catch((e) => {
                statusEl.textContent = `Upload failed: ${e.message}`;
                statusEl.className = "admin-status admin-status--error";
            });
    });
}
