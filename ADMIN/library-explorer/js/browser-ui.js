export function createModal({ title, submitLabel, bodyBuilder, onSubmit }) {
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";

    const box = document.createElement("div");
    box.className = "admin-modal-box be-lib-modal-box";

    const heading = document.createElement("h3");
    heading.className = "be-lib-modal-title";
    heading.textContent = title;
    box.appendChild(heading);

    const body = document.createElement("div");
    body.className = "be-lib-modal-body";
    box.appendChild(body);
    const fields = bodyBuilder(body);

    const errorEl = document.createElement("p");
    errorEl.className = "be-lib-modal-error";
    errorEl.hidden = true;
    box.appendChild(errorEl);

    const actions = document.createElement("div");
    actions.className = "admin-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "admin-button";
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", close);

    const okBtn = document.createElement("button");
    okBtn.className = "admin-button";
    okBtn.type = "button";
    okBtn.textContent = submitLabel || "Create";
    okBtn.addEventListener("click", async () => {
        errorEl.hidden = true;
        okBtn.disabled = true;
        try {
            const result = await onSubmit(fields, { setError, close });
            if (result !== false) {
                okBtn.disabled = false;
                close();
            }
        } catch (error) {
            setError(error.message);
        } finally {
            okBtn.disabled = false;
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKeydown);

    function onKeydown(e) {
        if (e.key === "Escape") close();
    }

    function setError(message) {
        errorEl.textContent = message;
        errorEl.hidden = !message;
    }

    function close() {
        if (okBtn.disabled) return;
        document.removeEventListener("keydown", onKeydown);
        overlay.remove();
    }

    return { overlay, close, setError };
}

export function addRow(body, labelText, inputEl, hintText) {
    const row = document.createElement("div");
    row.className = "be-lib-modal-row";

    const label = document.createElement("label");
    label.textContent = labelText;
    row.appendChild(label);
    row.appendChild(inputEl);

    body.appendChild(row);

    let hint = null;
    if (hintText) {
        hint = document.createElement("p");
        hint.className = "be-lib-modal-hint";
        hint.textContent = hintText;
        body.appendChild(hint);
    }

    return { row, hint };
}

export function textInput(placeholder) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "admin-field-input";
    if (placeholder) input.placeholder = placeholder;
    return input;
}

export function checkboxInput(checked) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "admin-field-input";
    input.style.flex = "0 0 auto";
    input.checked = !!checked;
    return input;
}

export function setButtonDisabled(btn, disabled, reasonTitle) {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? "0.4" : "";
    btn.style.cursor = disabled ? "not-allowed" : "";
    btn.title = disabled ? (reasonTitle || "") : "";
}

export function button(label, action, disabled = false) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "admin-button";
    el.textContent = label;
    el.disabled = disabled;
    el.addEventListener("click", action);
    return el;
}

export function text(parent, tag, value, className = "") {
    const el = document.createElement(tag);
    el.textContent = value;
    el.className = className;
    parent.appendChild(el);
    return el;
}

export function createContextMenu() {
    let menu = null;
    let events = null;

    function close() {
        events?.abort();
        menu?.remove();
        menu = null;
    }

    function open(event, items) {
        event.preventDefault();
        event.stopPropagation();
        close();

        menu = document.createElement("div");
        menu.className = "be-context-menu";

        for (const item of items) {
            const el = button(item.label, () => {
                close();
                item.action();
            });
            el.className = "be-context-menu-item" +
                (item.danger ? " be-context-menu-item--danger" : "");
            menu.appendChild(el);
        }

        document.body.appendChild(menu);

        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8))}px`;

        events = new AbortController();
        const options = { signal: events.signal };

        document.addEventListener("click", close, options);
        window.addEventListener("scroll", close, { ...options, capture: true });
        document.addEventListener("keydown", e => {
            if (e.key === "Escape") close();
        }, options);
    }

    return { open, close };
}