
import { renderMarkup, wireInteractions } from "./highlight.js";

const EMPTY_PLACEHOLDER = "Type blog content here…";

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

    wireInteractions(highlight, textarea);

    return {
        textarea,
        repaint,
        syncScroll,
        resetPlaceholder() { textarea.placeholder = EMPTY_PLACEHOLDER; },
    };
}
