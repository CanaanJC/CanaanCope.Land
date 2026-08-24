export default function init(root) {
    const preview  = root.querySelector("#lu-preview");
    const fileIn   = root.querySelector("#lu-file");
    const chooseBtn= root.querySelector("#lu-choose");
    const statusEl = root.querySelector("#lu-status");

    let siteAddress = "";

    function refreshPreview() {
        if (!siteAddress) return;
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
