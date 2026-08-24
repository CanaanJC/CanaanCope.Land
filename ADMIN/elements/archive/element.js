function fmtDate(iso) {
    try {
        return new Date(iso).toLocaleString(undefined, {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
    } catch {
        return iso;
    }
}

export default function init(root) {
    const maxInstancesEl = root.querySelector("#arc-max-instances");
    const idleTimeoutEl  = root.querySelector("#arc-idle-timeout");
    const maxRuntimeEl   = root.querySelector("#arc-max-runtime");
    const countEl        = root.querySelector("#arc-count");
    const listEl         = root.querySelector("#arc-list");

    fetch("/api/archive-list")
        .then(r => r.json())
        .then((data) => {
            const { settings, publicPort, entries } = data;

            maxInstancesEl.textContent = `Max concurrent instances: ${settings.maxConcurrentInstances}`;
            idleTimeoutEl.textContent  = `Idle timeout: ${settings.idleTimeoutMinutes}m`;
            maxRuntimeEl.textContent   = `Max runtime: ${settings.maxRuntimeMinutes}m`;
            countEl.textContent        = `Total backups: ${entries.length}`;

            listEl.innerHTML = "";

            if (entries.length === 0) {
                const empty = document.createElement("div");
                empty.className = "admin-archive-empty";
                empty.textContent = "No backups yet.";
                listEl.appendChild(empty);
                return;
            }

            const host = window.location.hostname;

            for (const entry of entries) {
                const row = document.createElement("div");
                row.className = "admin-archive-row";

                const link = document.createElement("a");
                link.className = "admin-archive-link";
                link.href = `http://${host}:${publicPort}/archive/${entry.uuid}`;
                link.target = "_blank";
                link.rel = "noopener noreferrer";

                // Shows the tag instead of the uuid — e.g. "2026-08-23 14:30:00 — monthly backup".
                // If this entry has no tag (older backups made before this
                // feature, or something went wrong writing it), the tag
                // portion is simply left blank rather than falling back to
                // the uuid.
                link.textContent = entry.tag
                    ? `${fmtDate(entry.timestamp)} — ${entry.tag}`
                    : `${fmtDate(entry.timestamp)} — `;
                link.title = entry.uuid; // uuid still available on hover

                const downloadLink = document.createElement("a");
                downloadLink.className = "admin-archive-download";
                downloadLink.href = `/api/archive-download/${entry.uuid}`;
                downloadLink.title = "Download this backup's full folder as a .tar";
                downloadLink.textContent = "Download";

                row.appendChild(link);
                row.appendChild(downloadLink);
                listEl.appendChild(row);
            }
        })
        .catch((e) => {
            listEl.innerHTML = "";
            const empty = document.createElement("div");
            empty.className = "admin-archive-empty";
            empty.textContent = `Failed to load archive list: ${e.message}`;
            listEl.appendChild(empty);
        });
}
