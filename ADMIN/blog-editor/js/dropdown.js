// ─────────────────────────────────────────────────────────────────────────────
// Library/blog select dropdown — positions itself under the trigger button,
// closes on outside click / window resize, and rebuilds its list from the
// current `libraries` + `selectedBlog` state on every render() call.
// ─────────────────────────────────────────────────────────────────────────────

export function createDropdown({ btn, panel, onSelect }) {
    function close() {
        panel.hidden = true;
    }

    function open() {
        const rect = btn.getBoundingClientRect();
        panel.style.top  = `${rect.bottom + 6}px`;
        panel.style.left = `${rect.left}px`;
        panel.hidden = false;
    }

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (panel.hidden) open(); else close();
    });

    document.addEventListener("click", (e) => {
        if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) close();
    });

    window.addEventListener("resize", () => {
        if (!panel.hidden) open();
    });

    function render(libraries, selectedBlog) {
        panel.innerHTML = "";

        if (libraries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "be-dropdown-empty";
            empty.textContent = "No libraries found.";
            panel.appendChild(empty);
            return;
        }

        for (const lib of libraries) {
            const heading = document.createElement("div");
            heading.className = "be-dropdown-group-heading";
            heading.textContent = lib.libraryName;
            panel.appendChild(heading);

            if (lib.blogs.length === 0) {
                const empty = document.createElement("div");
                empty.className = "be-dropdown-empty";
                empty.textContent = "(no blogs)";
                panel.appendChild(empty);
                continue;
            }

            for (const blog of lib.blogs) {
                const item = document.createElement("button");
                item.type = "button";
                item.className = "be-dropdown-item";
                if (selectedBlog && selectedBlog.urlPath === blog.urlPath) {
                    item.classList.add("be-dropdown-item--active");
                }
                item.textContent = blog.name;
                item.addEventListener("click", () => {
                    close();
                    onSelect(blog);
                });
                panel.appendChild(item);
            }
        }
    }

    return { open, close, render };
}
