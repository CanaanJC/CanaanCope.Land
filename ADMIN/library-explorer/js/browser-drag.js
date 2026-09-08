import { post, request } from "./browser-api.js";

export function createDragSorting(ctx) {
    let source = null;

    function clear() {
        for (const row of ctx.listEl.querySelectorAll(".be-lib-row")) {
            row.classList.remove("be-lib-row--dragging");
            row.style.borderTop = "";
            row.style.borderBottom = "";
        }
    }

    function wire(row, item, library = false) {
        const state = ctx.state;
        if (state.busy || (!library && (
            state.lib?.virtual || state.lib?.useDates === true || item.root
        ))) return;

        row.draggable = true;

        row.addEventListener("dragstart", event => {
            if (ctx.isEditing() || ctx.state.busy) {
                event.preventDefault();
                ctx.status("Save your config changes before reordering.", "error");
                return;
            }
            source = { item, library, lib: state.lib?.path, sub: state.sub };
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", library ? item.path : item.name);
            row.classList.add("be-lib-row--dragging");
        });

        row.addEventListener("dragend", () => {
            source = null;
            clear();
        });

        function valid() {
            return source && source.library === library && source.item !== item &&
                (library || (
                    source.item.type === item.type &&
                    source.lib === state.lib?.path &&
                    source.sub === state.sub
                ));
        }

        row.addEventListener("dragover", event => {
            if (!valid()) return;
            event.preventDefault();
            clear();
            const rect = row.getBoundingClientRect();
            const after = event.clientY >= rect.top + rect.height / 2;
            row.style[after ? "borderBottom" : "borderTop"] = "2px solid #7ec87e";
        });

        row.addEventListener("dragleave", clear);

        row.addEventListener("drop", async event => {
            if (!valid()) return;
            event.preventDefault();
            event.stopPropagation();

            const dragged = source.item;
            source = null;
            clear();

            const rect = row.getBoundingClientRect();
            const after = event.clientY >= rect.top + rect.height / 2;
            const current = library
                ? state.libraries
                : state.data.items.filter(entry => entry.type === item.type);
            const next = current.filter(entry => entry !== dragged);
            next.splice(next.indexOf(item) + (after ? 1 : 0), 0, dragged);

            if (next.every((entry, index) => entry === current[index])) return;

            await ctx.run(async () => {
                if (library) {
                    await request("/api/libraries", {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(next),
                    });
                } else {
                    await post("reorder", {
                        lib: state.lib.path,
                        sub: state.sub,
                        type: item.type,
                        expected: current.map(entry => entry.name),
                        order: next.map(entry => entry.name),
                    });
                }
                await ctx.reload();
            });
        });
    }

    return { wire, clear };
}