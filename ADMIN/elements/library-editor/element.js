// ─────────────────────────────────────────────────────────────────────────────
// Library-editor extension. The shared core (lib/js/json.js) already handles
// fetching/saving via the "libraries" endpoint, array/card rendering, delete
// + confirm, "+ Add", and automatic image-preview on the "icon" field. This
// file only adds what's unique to libraries:
//   - the field list / new-item shape
//   - the clickable LAN-link card title
//   - the icon upload button (via a field hook)
// ─────────────────────────────────────────────────────────────────────────────

const FIELDS = [
    { key: "id",       label: "ID",        type: "text" },
    { key: "name",     label: "Name",      type: "text" },
    { key: "path",     label: "Path",      type: "text" },
    { key: "depth",    label: "Depth",     type: "number" },
    { key: "useDates", label: "Use Dates", type: "checkbox" },
    { key: "icon",     label: "Icon",      type: "text" },
    { key: "hidden",   label: "Hidden",    type: "checkbox" },
];

function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export default function init(root, elementConfig, core) {
    let linkBase = null; // e.g. "http://192.168.0.133:2138"

    const loadLinkBase = fetch("/api/config")
        .then(r => r.json())
        .then((config) => {
            const lanIp = config?.backup?.lanIp;
            const port  = config?.hosting?.port;
            if (lanIp && port) linkBase = `http://${lanIp}:${port}`;
        })
        .catch((e) => console.error("Library editor: failed to load lanIp/port for links:", e));

    core.setNewItemFactory(() => ({
        id: "", name: "", path: "", depth: 1, useDates: false, icon: "", hidden: false,
    }));

    core.setCardTitle((lib) => {
        const label = lib.name || lib.path || "(unnamed library)";
        if (linkBase && lib.path && lib.path.trim() !== "") {
            const link = document.createElement("a");
            link.className = "admin-lib-title admin-lib-title--link";
            link.href = `${linkBase}/${lib.path}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = label;
            return link;
        }
        const span = document.createElement("span");
        span.className = "admin-lib-title";
        span.textContent = label;
        return span;
    });

    // Icon upload button — attached next to the auto image-preview the core
    // already renders for the "icon" field. Requires this item's Name field.
    core.registerFieldHook("icon", (row, api, item) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png";
        fileInput.hidden = true;

        const uploadBtn = document.createElement("button");
        uploadBtn.type = "button";
        uploadBtn.className = "admin-icon-upload-btn";
        uploadBtn.title = "Upload icon PNG";
        uploadBtn.textContent = "⬆";

        const requireName = () => {
            const libName = (item.name || "").trim();
            if (!libName) {
                alert("Please enter a Name for this library before uploading an icon.");
                return null;
            }
            return libName;
        };

        uploadBtn.addEventListener("click", () => {
            if (!requireName()) return;
            fileInput.click();
        });

        function doUpload(file, libName, overwrite) {
            file.arrayBuffer()
                .then((buf) => {
                    const params = new URLSearchParams({ name: libName });
                    if (overwrite) params.set("overwrite", "true");
                    return fetch(`/api/upload/library?${params.toString()}`, {
                        method: "POST",
                        headers: { "Content-Type": file.type || "application/octet-stream" },
                        body: buf,
                    });
                })
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (res.status === 409 && data.exists) {
                        const predicted = sanitizeAssetName(libName);
                        core.confirm(
                            `A file already exists at "media/libraries/${predicted}.png". Overwrite it?`,
                            "Overwrite",
                            () => doUpload(file, libName, true)
                        );
                        return;
                    }
                    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                    api.setValue(data.path);
                })
                .catch((e) => alert(`Icon upload failed: ${e.message}`));
        }

        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            fileInput.value = "";
            if (!file) return;
            const libName = requireName();
            if (!libName) return;
            doUpload(file, libName, false);
        });

        row.appendChild(uploadBtn);
        row.appendChild(fileInput);
    });

    loadLinkBase.then(() => {
        core.setArrayMode({
            fields: FIELDS,
            addLabel: "+ Add Library",
            cardTitle: (lib) => {
                const label = lib.name || lib.path || "(unnamed library)";
                if (linkBase && lib.path && lib.path.trim() !== "") {
                    const link = document.createElement("a");
                    link.className = "admin-lib-title admin-lib-title--link";
                    link.href = `${linkBase}/${lib.path}`;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = label;
                    return link;
                }
                const span = document.createElement("span");
                span.className = "admin-lib-title";
                span.textContent = label;
                return span;
            },
        });
    });
}
