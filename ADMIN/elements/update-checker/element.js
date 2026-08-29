// ─────────────────────────────────────────────────────────────────────────────
// Update checker element. GET /api/update-status only ever reads a cached
// result — the server itself checks GitHub on boot and once an hour (see
// lib/updateChecker.js). Loading/refreshing the admin page never triggers a
// network call on its own. The only thing that forces a real re-check is
// clicking the refresh button here, which POSTs /api/update-check.
// ─────────────────────────────────────────────────────────────────────────────

export default function init(root) {
    const localEl    = root.querySelector("#uc-local");
    const remoteEl   = root.querySelector("#uc-remote");
    const refreshBtn = root.querySelector("#uc-refresh");
    const bannerEl   = root.querySelector("#uc-banner");
    const statusEl   = root.querySelector("#uc-status");

    function setStatus(text, kind) {
        statusEl.textContent = text;
        statusEl.className = kind ? `admin-status admin-status--${kind}` : "admin-status";
    }

    function render(data) {
        localEl.textContent  = data.localVersion  || "unknown";
        remoteEl.textContent = data.remoteVersion || "unknown";
        bannerEl.hidden = !data.updateAvailable;

        if (data.error) {
            setStatus(`Check failed: ${data.error}`, "error");
        } else if (data.lastChecked) {
            setStatus(`Last checked: ${new Date(data.lastChecked).toLocaleString()}`);
        } else {
            setStatus("");
        }
    }

    function loadStatus() {
        fetch("/api/update-status")
            .then(r => r.json())
            .then(render)
            .catch((e) => setStatus(`Failed to load: ${e.message}`, "error"));
    }

    refreshBtn.addEventListener("click", () => {
        refreshBtn.disabled = true;
        refreshBtn.classList.add("uc-refresh-btn--spinning");
        setStatus("Checking…");

        fetch("/api/update-check", { method: "POST" })
            .then(r => r.json())
            .then((data) => {
                if (data.error) throw new Error(data.error);
                render(data);
            })
            .catch((e) => setStatus(`Check failed: ${e.message}`, "error"))
            .finally(() => {
                refreshBtn.disabled = false;
                refreshBtn.classList.remove("uc-refresh-btn--spinning");
            });
    });

    loadStatus();
}
