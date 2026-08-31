
import { getTagColors, getStlDefaults } from "./library-config.js";
import { toggleSelection, onSelectionChange } from "./selection-mode.js";
import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS, getExt } from "./media-manager.js";

function createSmallModal({ title, bodyBuilder, onSubmit }) {
    const overlay = document.createElement("div");
    overlay.className = "admin-modal-overlay";

    const box = document.createElement("div");
    box.className = "admin-modal-box be-toolbar-modal-box";

    const heading = document.createElement("h3");
    heading.className = "be-toolbar-modal-title";
    heading.textContent = title;
    box.appendChild(heading);

    const body = document.createElement("div");
    body.className = "be-toolbar-modal-body";
    box.appendChild(body);
    const fields = bodyBuilder(body);

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
    okBtn.textContent = "OK";
    okBtn.addEventListener("click", () => {
        const result = onSubmit(fields);
        if (result !== false) close();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close() {
        overlay.remove();
    }

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    return { close };
}

function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end   = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after  = textarea.value.slice(end);
    textarea.value = `${before}${text}${after}`;
    const newPos = start + text.length;
    textarea.selectionStart = textarea.selectionEnd = newPos;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
}

function tagExists(text, openTag) {
    return text.includes(openTag);
}

function suggestNextParagraph(text) {
    const re = /\[P(\d+)([abAB]?)\]/g;
    let match;
    const numbers = new Map(); // num -> { a: bool, b: bool, full: bool }

    while ((match = re.exec(text)) !== null) {
        const num = parseInt(match[1], 10);
        const suffix = match[2].toLowerCase();
        if (!numbers.has(num)) numbers.set(num, { a: false, b: false, full: false });
        const entry = numbers.get(num);
        if (suffix === "a") entry.a = true;
        else if (suffix === "b") entry.b = true;
        else entry.full = true;
    }

    if (numbers.size === 0) {
        return { num: 1, align: "Left" };
    }

    const maxNum = Math.max(...numbers.keys());
    const entry = numbers.get(maxNum);

    if (entry.a && !entry.b) {
        return { num: maxNum, align: "Right" };
    }

    return { num: maxNum + 1, align: "Left" };
}

function openParagraphDialog(getTextarea) {
    const textarea = getTextarea();
    const suggestion = suggestNextParagraph(textarea ? textarea.value : "");

    createSmallModal({
        title: "Insert Paragraph Tag",
        bodyBuilder(body) {
            const numRow = document.createElement("div");
            numRow.className = "be-toolbar-modal-row";
            const numLabel = document.createElement("label");
            numLabel.textContent = "Paragraph number:";
            const numInput = document.createElement("input");
            numInput.type = "number";
            numInput.min = "1";
            numInput.className = "admin-field-input";
            numInput.value = String(suggestion.num);
            numRow.appendChild(numLabel);
            numRow.appendChild(numInput);
            body.appendChild(numRow);

            const alignRow = document.createElement("div");
            alignRow.className = "be-toolbar-modal-row";
            const alignLabel = document.createElement("label");
            alignLabel.textContent = "Alignment:";
            alignRow.appendChild(alignLabel);

            const select = document.createElement("select");
            select.className = "le-select";
            for (const opt of ["Full", "Left", "Right"]) {
                const optionEl = document.createElement("option");
                optionEl.value = opt;
                optionEl.textContent = opt;
                select.appendChild(optionEl);
            }
            select.value = suggestion.align;
            alignRow.appendChild(select);
            body.appendChild(alignRow);

            requestAnimationFrame(() => numInput.focus());

            return { numInput, select };
        },
        onSubmit({ numInput, select }) {
            const num = parseInt(numInput.value, 10);
            if (!num || num < 1) {
                alert("Please enter a valid paragraph number.");
                return false;
            }

            const suffixMap = { Full: "", Left: "a", Right: "b" };
            const suffix  = suffixMap[select.value] || "";
            const tagName = `P${num}${suffix}`;
            const openTag  = `[${tagName}]`;
            const closeTag = `[/${tagName}]`;

            const textarea = getTextarea();
            if (!textarea) return false;

            if (tagExists(textarea.value, openTag)) {
                alert(`Paragraph ${tagName} already exists.`);
                return false;
            }

            insertAtCursor(textarea, `${openTag}\n\n${closeTag}`);
            return true;
        },
    });
}

function openLinkDialog(getTextarea) {
    createSmallModal({
        title: "Insert Link Embed",
        bodyBuilder(body) {
            const linkRow = document.createElement("div");
            linkRow.className = "be-toolbar-modal-row";
            const linkLabel = document.createElement("label");
            linkLabel.textContent = "Link URL:";
            const linkInput = document.createElement("input");
            linkInput.type = "text";
            linkInput.className = "admin-field-input";
            linkInput.placeholder = "https://example.com";
            linkRow.appendChild(linkLabel);
            linkRow.appendChild(linkInput);
            body.appendChild(linkRow);

            const interactRow = document.createElement("div");
            interactRow.className = "be-toolbar-modal-row";
            const interactLabel = document.createElement("label");
            interactLabel.textContent = "Interactable:";
            const interactInput = document.createElement("input");
            interactInput.type = "checkbox";
            interactRow.appendChild(interactLabel);
            interactRow.appendChild(interactInput);
            body.appendChild(interactRow);

            requestAnimationFrame(() => linkInput.focus());

            return { linkInput, interactInput };
        },
        onSubmit({ linkInput, interactInput }) {
            const url = linkInput.value.trim();
            if (!url) {
                alert("Please enter a link URL.");
                return false;
            }

            const textarea = getTextarea();
            if (!textarea) return false;

            const tag = interactInput.checked
                ? `<link:${url}|interactive>`
                : `<link:${url}>`;

            insertAtCursor(textarea, tag);
            return true;
        },
    });
}

function openVideoDialog(onConfirm) {
    createSmallModal({
        title: "Insert Video Tag",
        bodyBuilder(body) {
            const row = document.createElement("div");
            row.className = "be-toolbar-modal-row";
            const label = document.createElement("label");
            label.textContent = "Loop (autoplay, muted, no audio):";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = false;
            row.appendChild(label);
            row.appendChild(checkbox);
            body.appendChild(row);
            return { checkbox };
        },
        onSubmit({ checkbox }) {
            onConfirm(checkbox.checked);
            return true;
        },
    });
}

function renderSimpleMarkdown(md) {
    const escapeHtml = (s) => s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    function inlineMd(text) {
        let out = escapeHtml(text);
        out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
        out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return out;
    }

    const lines = md.split("\n");
    let html = "";
    let inList = false;
    let inCode = false;

    for (const line of lines) {
        if (/^```/.test(line)) {
            if (inCode) { html += "</pre>"; inCode = false; }
            else { html += "<pre>"; inCode = true; }
            continue;
        }
        if (inCode) { html += escapeHtml(line) + "\n"; continue; }

        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            if (inList) { html += "</ul>"; inList = false; }
            const level = headingMatch[1].length;
            html += `<h${level}>${inlineMd(headingMatch[2])}</h${level}>`;
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            if (!inList) { html += "<ul>"; inList = true; }
            html += `<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
            continue;
        } else if (inList) {
            html += "</ul>";
            inList = false;
        }

        if (line.trim() === "") { continue; }
        html += `<p>${inlineMd(line)}</p>`;
    }
    if (inList) html += "</ul>";
    if (inCode) html += "</pre>";
    return html;
}

export function openMarkdownHelp(mdUrl) {
    const overlay = document.createElement("div");
    overlay.className = "be-tags-help-overlay";

    const box = document.createElement("div");
    box.className = "be-tags-help-box";

    const closeBtn = document.createElement("button");
    closeBtn.className = "be-tags-help-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", close);

    const content = document.createElement("div");
    content.className = "be-tags-help-content";
    content.textContent = "Loading…";

    box.appendChild(closeBtn);
    box.appendChild(content);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    function close() {
        overlay.remove();
    }

    fetch(mdUrl)
        .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        })
        .then((md) => { content.innerHTML = renderSimpleMarkdown(md); })
        .catch((e) => { content.textContent = `Failed to load ${mdUrl}: ${e.message}`; });
}

export function initToolbar({ toolbarEl, tagsHelpBtnEl, mediaHelpBtnEl, getTextarea, isMarkdownMode }) {
    const colors = getTagColors();
    const stl    = getStlDefaults();

    function makeSelectionButton({ text, colorKey, buildType }) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "admin-button be-tool-btn";
        btn.textContent = text;
        btn.style.setProperty("--tool-color", colors[colorKey] || "inherit");
        const type = buildType();
        btn.addEventListener("click", () => {
            if (!isMarkdownMode()) return;
            toggleSelection(type);
        });
        onSelectionChange((active) => {
            btn.classList.toggle("be-tool-btn--selecting", !!(active && active.key === type.key));
        });
        return btn;
    }

    const paragraphBtn = document.createElement("button");
    paragraphBtn.type = "button";
    paragraphBtn.className = "admin-button be-tool-btn";
    paragraphBtn.textContent = "[Paragraph]";
    paragraphBtn.style.setProperty("--tool-color", colors.paragraph || "inherit");
    paragraphBtn.addEventListener("click", () => {
        if (!isMarkdownMode()) return;
        openParagraphDialog(getTextarea);
    });

    const mobileBtn = document.createElement("button");
    mobileBtn.type = "button";
    mobileBtn.className = "admin-button be-tool-btn";
    mobileBtn.textContent = "[Mobile]";
    mobileBtn.style.setProperty("--tool-color", colors.mobile || "inherit");
    mobileBtn.addEventListener("click", () => {
        if (!isMarkdownMode()) return;
        const textarea = getTextarea();
        if (!textarea) return;
        insertAtCursor(textarea, "[M1]\n\n[/M1]");
    });

    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "admin-button be-tool-btn";
    linkBtn.textContent = "<link embed>";
    linkBtn.style.setProperty("--tool-color", colors.link || "inherit");
    linkBtn.addEventListener("click", () => {
        if (!isMarkdownMode()) return;
        openLinkDialog(getTextarea);
    });

    const stlBtn = makeSelectionButton({
        text: "<STL>",
        colorKey: "stl",
        buildType: () => ({
            key: "stl",
            color: colors.stl || "#ceb8ff",
            matches: (item) => !item.isFolder && getExt(item.name) === "stl",
            onPick: (item, relPath) => {
                const textarea = getTextarea();
                if (!textarea) return;
                const bg    = stl.background || "#1E1E1E";
                const model = stl.model      || "#932E2F";
                insertAtCursor(textarea, `<stl:${relPath}|${bg}|${model}>`);
            },
        }),
    });

    const imageBtn = makeSelectionButton({
        text: "<image>",
        colorKey: "image",
        buildType: () => ({
            key: "image",
            color: colors.image || "#ff0000",
            matches: (item) => !item.isFolder && IMAGE_EXTS.has(getExt(item.name)),
            onPick: (item, relPath) => {
                const textarea = getTextarea();
                if (!textarea) return;
                insertAtCursor(textarea, `<${relPath}>`);
            },
        }),
    });

    const videoBtn = makeSelectionButton({
        text: "<video>",
        colorKey: "video",
        buildType: () => ({
            key: "video",
            color: colors.video || "#3347ff",
            matches: (item) => !item.isFolder && VIDEO_EXTS.has(getExt(item.name)),
            onPick: (item, relPath) => {
                openVideoDialog((loop) => {
                    const textarea = getTextarea();
                    if (!textarea) return;
                    insertAtCursor(textarea, loop ? `<${relPath} loop>` : `<${relPath}>`);
                });
            },
        }),
    });

    const audioBtn = makeSelectionButton({
        text: "<audio>",
        colorKey: "audio",
        buildType: () => ({
            key: "audio",
            color: colors.audio || "#ff00c8",
            matches: (item) => !item.isFolder && AUDIO_EXTS.has(getExt(item.name)),
            onPick: (item, relPath) => {
                const textarea = getTextarea();
                if (!textarea) return;
                insertAtCursor(textarea, `<${relPath}>`);
            },
        }),
    });

    const folderBtn = makeSelectionButton({
        text: "<folder>",
        colorKey: "folder",
        buildType: () => ({
            key: "folder",
            color: colors.folder || "#cbb8ff",
            matches: (item) => !!item.isFolder,
            onPick: (item, relPath) => {
                const textarea = getTextarea();
                if (!textarea) return;
                insertAtCursor(textarea, `<./${relPath}>`);
            },
        }),
    });

    toolbarEl.innerHTML = "";
    toolbarEl.appendChild(paragraphBtn);
    toolbarEl.appendChild(mobileBtn);
    toolbarEl.appendChild(linkBtn);
    toolbarEl.appendChild(stlBtn);
    toolbarEl.appendChild(imageBtn);
    toolbarEl.appendChild(videoBtn);
    toolbarEl.appendChild(audioBtn);
    toolbarEl.appendChild(folderBtn);

    if (tagsHelpBtnEl) {
        tagsHelpBtnEl.addEventListener("click", () => openMarkdownHelp("/library-explorer/tags.md"));
    }

    if (mediaHelpBtnEl) {
        mediaHelpBtnEl.addEventListener("click", () => openMarkdownHelp("/library-explorer/media.md"));
    }
}
