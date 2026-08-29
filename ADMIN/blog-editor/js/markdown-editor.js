// ─────────────────────────────────────────────────────────────────────────────
// content.md editor — plain raw-text editing via a real <textarea>, so native
// browser Undo/Redo and Enter-for-newline behave exactly like any normal
// text field. No markdown rendering/interpretation happens anywhere — the
// raw text in the textarea IS exactly what gets saved.
//
// A read-only, non-interactive overlay (<pre>) is stacked on top of the
// textarea purely to show tag-color syntax highlighting. It has
// pointer-events: none so every click passes straight through to the
// textarea underneath for normal cursor placement/selection/typing —
// except for the specific interactive bits (clickable links, color
// swatches), which re-enable pointer-events on themselves (see
// highlight.css / wireInteractions in highlight.js).
// ─────────────────────────────────────────────────────────────────────────────

import { renderMarkup, wireInteractions } from "./highlight.js";

export function mountMarkdownEditor(container) {
    container.innerHTML = `
        <div class="be-md-wrap">
            <pre class="be-md-highlight" aria-hidden="true"></pre>
            <textarea class="be-md-editable"
                      spellcheck="true"
                      wrap="off"
                      placeholder="Loading…"></textarea>
        </div>
    `;

    const highlight = container.querySelector(".be-md-highlight");
    const textarea  = container.querySelector(".be-md-editable");

    function repaint() {
        const text = textarea.value;
        // Trailing newline needs a trailing space in a <pre> for the empty
        // last line to actually take up visible height / stay scrollable
        // to, matching the textarea underneath exactly.
        highlight.innerHTML = renderMarkup(text) + (text.endsWith("\n") ? " " : "");
    }

    function syncScroll() {
        highlight.scrollTop  = textarea.scrollTop;
        highlight.scrollLeft = textarea.scrollLeft;
    }

    textarea.addEventListener("input", repaint);
    textarea.addEventListener("scroll", syncScroll);

    wireInteractions(highlight, textarea);

    return {
        textarea,
        repaint,
        syncScroll,
    };
}
