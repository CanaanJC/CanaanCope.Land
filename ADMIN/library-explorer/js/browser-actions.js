import { post, request, isPrivate } from "./browser-api.js";
import { createModal, addRow, textInput, checkboxInput } from "./browser-ui.js";

export function createActions(ctx) {
    const state = ctx.state;

    function form(title, definitions, submit, submitLabel = "Save") {
        if (!ctx.guard()) return;
        createModal({
            title,
            submitLabel,
            bodyBuilder(body) {
                const inputs = {};
                for (const definition of definitions) {
                    const input = definition.boolean ? checkboxInput(definition.value) : textInput(definition.placeholder);
                    if (!definition.boolean) input.value = definition.value || "";
                    inputs[definition.key] = input;
                    addRow(body, definition.label, input, definition.hint);
                }
                requestAnimationFrame(() => Object.values(inputs)[0]?.focus());
                return inputs;
            },
            async onSubmit(inputs) {
                if (state.busy) throw new Error("Another operation is in progress");
                state.busy = true;
                try {
                    const values = Object.fromEntries(definitions.map(definition => [
                        definition.key,
                        definition.boolean ? inputs[definition.key].checked : inputs[definition.key].value.trim(),
                    ]));
                    const result = await submit(values);
                    if (result?.warning) alert(result.warning);
                    await ctx.reload();
                } finally {
                    state.busy = false;
                    ctx.render();
                }
            },
        });
    }

    function create(type) {
        if (!ctx.canCreate()) return;
        const location = { lib: state.lib.path, sub: state.sub };
        const blog = type === "blog";
        form(blog ? "New Blog" : "New Folder", [
            {
                key: "filename",
                label: "File name:",
                placeholder: blog ? "my-new-post" : "my-new-folder",
                hint: "The folder name on disk, used in the URL.",
            },
            {
                key: "title",
                label: blog ? "Blog title:" : "Folder name:",
                placeholder: blog ? "My New Post" : "My New Folder",
                hint: `The display name, saved as "name" in ${blog ? "config.json" : "folder.json"}.`,
            },
        ], values => {
            if (!values.filename) throw new Error("File name is required");
            if (!values.title) throw new Error(blog ? "Blog title is required" : "Folder name is required");
            return post(blog ? "new-blog" : "folder", {
                ...location,
                ...(blog ? { filename: values.filename } : { name: values.filename }),
                title: values.title,
            });
        }, blog ? "Create Blog" : "Create Folder");
    }

    function newLibrary() {
        if (!ctx.guard()) return;
        let picked = null;
        createModal({
            title: "New Library",
            submitLabel: "Create Library",
            bodyBuilder(body) {
                const path = textInput("my-library");
                const name = textInput("My Library");
                const useDates = checkboxInput(false);
                const privateInput = checkboxInput(false);
                const icon = document.createElement("input");
                icon.type = "file";
                icon.accept = "image/png";
                icon.addEventListener("change", () => { picked = icon.files[0] || null; });
                addRow(body, "Path:", path);
                addRow(body, "Name:", name);
                addRow(body, "Sort by date:", useDates, "Newest end date first; undated blogs follow. Disables blog and folder dragging.");
                addRow(body, "Private:", privateInput, "Reachable directly, but omitted from public navigation.");
                addRow(body, "Icon:", icon, "Optional PNG.");
                return { path, name, useDates, privateInput };
            },
            async onSubmit(fields) {
                const path = fields.path.value.trim();
                const name = fields.name.value.trim();
                if (!path || !name) throw new Error("Path and name are required");
                if (state.busy) throw new Error("Another operation is in progress");
                state.busy = true;
                try {
                    const result = await post("new-library", {
                        path, name, useDates: fields.useDates.checked, private: fields.privateInput.checked, icon: "",
                    });
                    if (picked) {
                        try {
                            const uploaded = await request(`/api/upload/library?${new URLSearchParams({ name: path, overwrite: "false" })}`, {
                                method: "POST",
                                headers: { "Content-Type": picked.type || "image/png" },
                                body: await picked.arrayBuffer(),
                            });
                            const libraries = await request("/api/libraries");
                            const entry = libraries.find(library => library.path === result.library.path);
                            entry.icon = uploaded.path;
                            await request("/api/libraries", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(libraries),
                            });
                        } catch (error) {
                            alert(`Library created, but icon could not be saved: ${error.message}`);
                        }
                    }
                    state.lib = result.library;
                    state.sub = "";
                    state.selected = null;
                    await ctx.reload();
                } finally {
                    state.busy = false;
                    ctx.render();
                }
            },
        });
    }

    function rename(item, library = false) {
        form(library ? "Rename Library" : "Rename Folder", [
            { key: "name", label: library ? "Library label:" : "Folder name:", value: item.name },
        ], async values => {
            const result = await post(library ? "update-library" : "rename", library
                ? { path: item.path, name: values.name }
                : { lib: item.lib, sub: item.sub, oldName: item.name, newName: values.name });
            state.selected = null;
            state.move = null;
            return result;
        });
    }

    function remove(item, library = false) {
        if (!ctx.guard()) return;
        const label = item.displayName || item.name;
        if (library) {
            const typed = prompt(`Delete library "${label}" and ALL its contents? Type its path to confirm: ${item.path}`);
            if (typed !== item.path) return;
        } else if (!confirm(`Permanently delete "${label}" and everything inside it?`)) return;
        ctx.run(async () => {
            const result = await post(library ? "delete-library" : "delete", library
                ? { path: item.path }
                : { lib: item.lib, sub: item.sub, name: item.name, type: item.type });
            if (result.warning) alert(result.warning);
            state.selected = null;
            state.move = null;
            if (library && state.lib?.path === item.path) {
                state.lib = null;
                state.sub = "";
            }
            await ctx.reload();
        });
    }

    function move(item) {
        if (!ctx.guard()) return;
        state.move = { ...item };
        ctx.render();
    }

    function canMove() {
        if (!state.move || !ctx.canCreate()) return false;
        const from = [state.move.lib, state.move.sub, state.move.name].filter(Boolean).join("/");
        const to = [state.lib.path, state.sub].filter(Boolean).join("/");
        return to !== from && !to.startsWith(from + "/") &&
            !(state.move.lib === state.lib.path && state.move.sub === state.sub);
    }

    function moveHere() {
        if (!canMove() || !ctx.guard()) return;
        const item = state.move;
        ctx.run(async () => {
            await post("move", {
                fromLib: item.lib, fromSub: item.sub, name: item.name, type: item.type,
                toLib: state.lib.path, toSub: state.sub,
            });
            state.move = null;
            state.selected = null;
            await ctx.reload();
        });
    }

    function menu(item, library = false) {
        if (library) return [
            { label: "Open Library Page", action: () => ctx.openLive(item.path) },
            { label: "Rename", action: () => rename(item, true) },
            {
                label: isPrivate(item) ? "Make Public" : "Make Private",
                action: () => {
                    if (!ctx.guard()) return;
                    ctx.run(async () => {
                        await post("update-library", { path: item.path, private: !isPrivate(item) });
                        await ctx.reload();
                    });
                },
            },
            { label: "Delete Library", danger: true, action: () => remove(item, true) },
        ];
        if (item.root || item.isAboutMe) return [];
        return [
            { label: "Rename", action: () => rename(item) },
            { label: "Move", action: () => move(item) },
            { label: "Delete", danger: true, action: () => remove(item) },
        ];
    }

    return { create, newLibrary, menu, canMove, moveHere };
}