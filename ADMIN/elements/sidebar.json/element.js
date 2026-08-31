
const FIELDS = [
    { key: "text",  label: "Text",  type: "text" },
    { key: "link",  label: "Link",  type: "text" },
    { key: "image", label: "Image", type: "text" },
];

function sanitizeAssetName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export default function init(root, elementConfig, core) {
    core.registerFieldHook("image", (row, api, item) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/png";
        fileInput.hidden = true;

        const uploadBtn = document.createElement("button");
        uploadBtn.type = "button";
        uploadBtn.className = "admin-icon-upload-btn";
        uploadBtn.title = "Upload image PNG";
        uploadBtn.textContent = "⬆";

        const requireName = () => {
            const linkName = (item.text || "").trim();
            if (!linkName) {
                alert("Please enter Text (the link name) before uploading an image.");
                return null;
            }
            return linkName;
        };

        uploadBtn.addEventListener("click", () => {
            if (!requireName()) return;
            fileInput.click();
        });

        function doUpload(file, linkName, overwrite) {
            file.arrayBuffer()
                .then((buf) => {
                    const params = new URLSearchParams({ name: linkName });
                    if (overwrite) params.set("overwrite", "true");
                    return fetch(`/api/upload/sidebar?${params.toString()}`, {
                        method: "POST",
                        headers: { "Content-Type": file.type || "application/octet-stream" },
                        body: buf,
                    });
                })
                .then(async (res) => {
                    const data = await res.json().catch(() => ({}));
                    if (res.status === 409 && data.exists) {
                        const predicted = sanitizeAssetName(linkName);
                        core.confirm(
                            `A file already exists at "media/sidebar/${predicted}.png". Overwrite it?`,
                            "Overwrite",
                            () => doUpload(file, linkName, true)
                        );
                        return;
                    }
                    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
                    api.setValue(data.path);
                })
                .catch((e) => alert(`Image upload failed: ${e.message}`));
        }

        fileInput.addEventListener("change", () => {
            const file = fileInput.files[0];
            fileInput.value = "";
            if (!file) return;
            const linkName = requireName();
            if (!linkName) return;
            doUpload(file, linkName, false);
        });

        row.appendChild(uploadBtn);
        row.appendChild(fileInput);
    });

    core.setArrayMode({
        fields: FIELDS,
        addLabel: "+ Add Link",
        newItemFactory: () => ({ text: "", link: "", image: "" }),
        cardTitle: (item) => item.text || "(unnamed link)",
    });
}
