// ─────────────────────────────────────────────────────────────────────────────
// content.md syntax highlighter. Produces ONE HTML markup string — colored
// tag spans, plus plain (unstyled) clickable spans for any http(s) URL,
// wherever it appears — meant to be the innerHTML of the read-only overlay
// stacked on top of the real editing <textarea> (see markdown-editor.js).
//
// Nothing here ever rewrites the underlying raw text. Tags render in their
// configured colors (see tags.json / tags-config.js). Links — whether bare
// in plain text or inside a <link:...> tag — are the ONE thing that is
// never rendered as plain flat text-with-no-interaction: they're still
// real, clickable targets, but deliberately NOT given any markdown-style
// coloring/underlining. They look like ordinary plain text.
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_RE =
    /(\[\/?[A-Za-z]+\d*[a-z]?\])|(<[^<>\n]*>)|(https?:\/\/[^\s<>()\]|]+)/g;

export function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function classifyBlockTag(tag) {
    if (/^\[\/?M/i.test(tag)) return "tag-mobile";
    if (/^\[\/?P/i.test(tag)) return "tag-paragraph";
    return null;
}

function classifyInline(trimmed) {
    if (/^stl:/i.test(trimmed)) return { cls: "tag-stl", kind: "stl" };
    // Link tag: everything (the "link:" label, "|caption" text, etc.) gets
    // the tag-link color EXCEPT the URL itself, which stays plain text
    // color (see .tag-link .be-linkable override in highlight.css) while
    // still being a real clickable target.
    if (/^link:/i.test(trimmed)) return { cls: "tag-link", kind: "link" };
    if (/^\.\//.test(trimmed)) return { cls: "tag-folder", kind: "folder" };
    if (/\.(mp4|webm|gif)(\s|$)/i.test(trimmed)) return { cls: "tag-video", kind: "video" };
    if (/\.(png|jpe?g|webp|svg|avif)(\s|$)/i.test(trimmed)) return { cls: "tag-image", kind: "image" };
    if (/\.(mp3|wav)(\s|$)/i.test(trimmed)) return { cls: "tag-audio", kind: "audio" };
    return { cls: null, kind: "plain" };
}


// Plain, unstyled, but real clickable span — no color/underline, just a
// pointer cursor. See highlight.css's .be-linkable for the (lack of)
// styling and the pointer-events re-enable.
function renderLinkChip(url) {
    const safeUrl = escapeHtml(url);
    return `<span class="be-linkable" data-url="${safeUrl}">${safeUrl}</span>`;
}

function linkifyBareUrls(rawFragment) {
    const urlRe = /https?:\/\/[^\s<>()\]|]+/g;
    let out = "";
    let cursor = 0;
    let m;
    while ((m = urlRe.exec(rawFragment))) {
        out += escapeHtml(rawFragment.slice(cursor, m.index));
        out += renderLinkChip(m[0]);
        cursor = m.index + m[0].length;
    }
    out += escapeHtml(rawFragment.slice(cursor));
    return out;
}


// The swatch is purely a visual color-preview dot (background-color set
// inline to the real hex) — the adjacent hex TEXT itself is colored via
// its tag class (tag-stl) instead, per spec.
function renderSwatch(hex, absStart) {
    return `<span class="be-swatch" data-hex="${hex}" data-start="${absStart}" data-len="${hex.length}" style="--swatch-color:${hex}"><span class="be-swatch-cube"></span></span>`;
}

function renderInlineTag(raw, tagStart) {
    const inner      = raw.slice(1, -1);
    const trimmed    = inner.trim();
    const innerStart = tagStart + 1;
    const { cls, kind } = classifyInline(trimmed);

    let body   = "";
    let cursor = 0;

    if (kind === "stl") {
        const hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
        let hm;
        while ((hm = hexRe.exec(inner))) {
            body += escapeHtml(inner.slice(cursor, hm.index));
            const hex = hm[0];
            const absStart = innerStart + hm.index;
            // Hex text renders in the STL tag's own color (not its literal
            // hex value) — the swatch dot is the only thing that actually
            // shows the real color, as a visual-only indicator.
            body += escapeHtml(hex);
            body += renderSwatch(hex, absStart);
            cursor = hm.index + hex.length;
        }
        body += escapeHtml(inner.slice(cursor));
    } else if (kind === "link") {
        // Plain text, but any URL inside still becomes a real clickable
        // (unstyled) target.
        body = linkifyBareUrls(inner);
    } else {
        body = escapeHtml(inner);
    }

    body = body.replace(/\bloop\b/g, (m) => `<span class="tag-loop">${m}</span>`);

    if (cls) return `&lt;<span class="${cls}">${body}</span>&gt;`;
    return `&lt;${body}&gt;`;
}

export function renderMarkup(text) {
    let out = "";
    let lastIndex = 0;
    TOKEN_RE.lastIndex = 0;
    let m;

    while ((m = TOKEN_RE.exec(text))) {
        out += linkifyBareUrls(text.slice(lastIndex, m.index));

        if (m[1]) {
            const cls = classifyBlockTag(m[1]);
            const escaped = escapeHtml(m[1]);
            out += cls ? `<span class="${cls}">${escaped}</span>` : escaped;
        } else if (m[2]) {
            out += renderInlineTag(m[2], m.index);
        } else if (m[3]) {
            out += renderLinkChip(m[3]);
        }

        lastIndex = m.index + m[0].length;
    }

    out += linkifyBareUrls(text.slice(lastIndex));
    return out;
}

// ── Interaction wiring (links + swatches) ────────────────────────────────
// `highlightEl` is the read-only overlay (pointer-events: none, except on
// .be-linkable / .be-swatch children — see highlight.css). `textareaEl` is
// the real editing surface underneath; swatch edits write directly into
// its .value and dispatch a real "input" event so the existing
// repaint/dirty-tracking listeners (wired in markdown-editor.js /
// library-explorer.js) pick it up exactly like a normal keystroke would.
export function wireInteractions(highlightEl, textareaEl) {
    highlightEl.addEventListener("click", (e) => {
        const link = e.target.closest(".be-linkable[data-url]");
        if (link) {
            e.preventDefault();
            window.open(link.dataset.url, "_blank", "noopener,noreferrer");
            return;
        }

        const swatch = e.target.closest(".be-swatch[data-hex]");
        if (swatch) {
            e.preventDefault();
            openSwatchPicker(swatch, textareaEl);
        }
    });
}

function openSwatchPicker(swatch, textareaEl) {
    const start = parseInt(swatch.dataset.start, 10);
    const len   = parseInt(swatch.dataset.len, 10);
    const hex   = swatch.dataset.hex;
    if (isNaN(start) || isNaN(len)) return;

    const rect = swatch.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "color";
    input.className = "be-swatch-input";
    input.value = hex.length === 4
        ? `#${[...hex.slice(1)].map((c) => c + c).join("")}`
        : hex;
    input.style.left = `${rect.left}px`;
    input.style.top  = `${rect.top}px`;
    document.body.appendChild(input);

    const cleanup = () => input.remove();

    input.addEventListener("input", () => {
        const newHex = input.value;
        const text   = textareaEl.value;
        const before = text.slice(0, start);
        const after  = text.slice(start + len);
        textareaEl.value = `${before}${newHex}${after}`;
        textareaEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("blur", cleanup, { once: true });

    input.click();
    if (typeof input.showPicker === "function") {
        try { input.showPicker(); } catch {}
    }
}
