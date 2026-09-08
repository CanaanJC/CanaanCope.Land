import { mountBlogConfigPanel, mountFolderConfigPanel } from "./config-editor.js";
import { button, text } from "./browser-ui.js";

export function createDetails(ctx) {
    let token = 0;
    let core = null;
    let edited = false;

    function reset() {
        token += 1;
        core = null;
        edited = false;
    }

    function render() {
        reset();
        ctx.clearDirty();

        const currentToken = token;
        const state = ctx.state;
        const container = ctx.detailsEl;
        container.replaceChildren();

        const item = state.selected || state.data?.current;

        if (state.loading) {
            text(container, "p", "Loading…");
            return;
        }

        if (state.error) {
            text(container, "p", state.error, "admin-status admin-status--error");
            return;
        }

        if (!item) {
            text(container, "h3", state.lib?.virtual ? "All Blogs" : "Libraries");
            text(
                container,
                "p",
                state.lib?.virtual
                    ? "All blogs, including private entries, in library traversal order. Open a real library to create or reorder entries."
                    : "Choose a library. Drag libraries to reorder them; right-click for more actions.",
                "be-lib-details-note"
            );
            return;
        }

        const blog = item.type === "blog" || item.isAboutMe;

        text(container, "h3", item.displayName || item.name);
        text(
            container,
            "p",
            item.isAboutMe ? "public/aboutme" : `public/libraries/${item.urlPath}`
        );

        if (blog) {
            const actions = document.createElement("div");
            actions.className = "be-lib-edit-menu-actions";
            actions.appendChild(button("Edit", () => {
                if (!ctx.guard()) return;
                ctx.onOpenBlog({ ...item, name: item.displayName || item.name });
            }));
            actions.appendChild(button(
                "Open Live Page",
                () => ctx.openLive(item.isAboutMe ? "" : item.urlPath)
            ));
            container.appendChild(actions);
        } else {
            text(
                container,
                "p",
                state.lib.useDates === true
                    ? "Newest end date first; undated blogs follow. Drag sorting is disabled."
                    : "Blogs first, folders after. Drag within either group to update goAfter automatically.",
                "be-lib-details-note"
            );
        }

        if (item.isAboutMe) {
            text(
                container,
                "p",
                "Permanent page. About Me has no config.json.",
                "be-lib-details-note"
            );
            return;
        }

        text(container, "div", "", "be-lib-config-divider");

        const panel = document.createElement("div");
        panel.className = "be-lib-config-panel";
        container.appendChild(panel);

        const mount = blog ? mountBlogConfigPanel : mountFolderConfigPanel;

        mount(panel, item, {
            onEdit() {
                if (currentToken !== token) return;
                edited = true;
                ctx.markDirty();
            },
            onSaved() {
                if (currentToken !== token) return;
                edited = false;
                ctx.clearDirty();
                ctx.reload();
            },
        }).then(handle => {
            if (currentToken === token) core = handle;
        }).catch(error => {
            if (currentToken === token) {
                text(panel, "p", error.message, "admin-status admin-status--error");
            }
        });
    }

    return { render, reset, isEditing: () => edited || !!core?.isDirty() };
}