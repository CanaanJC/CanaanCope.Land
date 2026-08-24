// Inline fallback icon — same shape used on the public site (topbar.js /
// sidebar.js) for missing images. Shown here whenever no logo.png exists yet
// at the live site's /media/logo.png (a fresh checkout of this repo ships
// without a media/ folder at all, since it's gitignored).
const FALLBACK_ICON =
    'data:image/svg+xml;charset=UTF-8,' +
    encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none">
  <rect x="3" y="3" width="18" height="18" rx="3" ry="3" fill="#3a3a3a" stroke="#5a5a5a"/>
  <path d="M7 15l2.5-3 2 2.5L14.5 12 17 15" stroke="#cfcfcf" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="9" cy="9" r="1.25" fill="#cfcfcf"/>
</svg>`);

export default function init(root) {
    const preview   = root.querySelector("#lu-preview");
    const fileIn    = root.querySelector("#lu-file");
    const chooseBtn = root.querySelector("#lu-choose");
    const statusEl  = root.querySelector("#lu-status");

    let siteAddress = "";

    // Show the fallback icon immediately, before anything has loaded, so
    // there's never a moment showing a broken-image icon.
    preview.src = FALLBACK_ICON;
    preview.classList.add("admin-logo-preview--fallback");

    preview.addEventListener("error", () => {
        if (preview.src !== FALLBACK_ICON) {
            preview.src = FALLBACK_ICON;
            preview.classList.add("admin-logo-preview--fallback");
        }
    });

    function refreshPreview() {
        if (!siteAddress) return;
        preview.classList.remove("admin-logo-preview--fallback");
        preview.src = `${siteAddress.replace(/\/$/, "")}/media/logo.png?t=${Date.now()}`;
    }

    fetch("/api/site-info")
        .then(r => r.json())
        .then((info) => {
            siteAddress = info.siteAddress || "";
            refreshPreview();
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
                refreshPreview();
            })
            .catch((e) => {
                statusEl.textContent = `Upload failed: ${e.message}`;
                statusEl.className = "admin-status admin-status--error";
            });
    });
}
