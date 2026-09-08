
import { renderMarkup, wireInteractions } from "./highlight.js";

const EMPTY_PLACEHOLDER = "Type blog content here…";

function extractUrl(raw) {
    const text = String(raw || "").trim();
    if (!text || /\s/.test(text)) return null;
    if (!/^https?:\/\//i.test(text)) return null;

    try {
        const parsed = new URL(text);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        if (!parsed.hostname || !parsed.hostname.includes(".")) return null;
    } catch {
        return null;
    }

    return text;
}

function splitSelection(value, start, end) {
    const raw = value.slice(start, end);
    const leadMatch  = raw.match(/^\s*/);
    const trailMatch = raw.match(/\s*$/);
    const lead  = leadMatch ? leadMatch[0] : "";
    const trail = raw.length > lead.length && trailMatch ? trailMatch[0] : "";
    const core  = raw.slice(lead.length, raw.length - trail.length);
    return { lead, core, trail };
}

function replaceSelection(textarea, replacement, caretOffset) {
    const start = textarea.selectionStart;
    const end   = textarea.selectionEnd;

    let inserted = false;
    if (typeof document.execCommand === "function") {
        try {
            inserted = document.execCommand("insertText", false, replacement);
        } catch {
            inserted = false;
        }
    }

    if (!inserted) {
        const before = textarea.value.slice(0, start);
        const after  = textarea.value.slice(end);
        textarea.value = `${before}${replacement}${after}`;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const caret = start + (typeof caretOffset === "number" ? caretOffset : replacement.length);
    textarea.selectionStart = textarea.selectionEnd = caret;
}

function wirePasteLinkWrap(textarea) {
    textarea.addEventListener("paste", (e) => {
        if (!e.clipboardData) return;

        const start = textarea.selectionStart;
        const end   = textarea.selectionEnd;
        if (start === end) return;

        const url = extractUrl(e.clipboardData.getData("text/plain"));
        if (!url) return;

        const { lead, core, trail } = splitSelection(textarea.value, start, end);
        if (!core) return;
        if (/[[\]]/.test(core)) return;

        e.preventDefault();

        const markdown = `${lead}[${core}](${url})${trail}`;
        replaceSelection(textarea, markdown, markdown.length);
        textarea.focus();
    });
}

export function mountMarkdownEditor(container) {
    container.innerHTML = `
        <div class="be-md-wrap">
            <pre class="be-md-highlight" aria-hidden="true"></pre>
            <textarea class="be-md-editable"
                      spellcheck="true"
                      wrap="off"
                      placeholder="${EMPTY_PLACEHOLDER}"></textarea>
        </div>
    `;

    const highlight = container.querySelector(".be-md-highlight");
    const textarea  = container.querySelector(".be-md-editable");

    function repaint() {
        const text = textarea.value;
        highlight.innerHTML = renderMarkup(text) + (text.endsWith("\n") ? " " : "");
    }

    function syncScroll() {
        highlight.scrollTop  = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;
    }

    textarea.addEventListener("input", repaint);
    textarea.addEventListener("scroll", syncScroll);

    wirePasteLinkWrap(textarea);
    wireInteractions(highlight, textarea);

    return {
        textarea,
        repaint,
        syncScroll,
        resetPlaceholder() { textarea.placeholder = EMPTY_PLACEHOLDER; },
    };
}