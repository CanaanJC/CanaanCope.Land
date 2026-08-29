// ADMIN/blog-editor/js/selection-mode.js
// ─────────────────────────────────────────────────────────────────────────────
// Generic "media selection mode" framework — shared by any toolbar button
// that needs to say "let the user pick a media file of kind X from the
// media manager". Deliberately has NO knowledge of what kinds exist (STL,
// image, etc.) — callers register a plain "selection type" object and this
// module just tracks which one (if any) is currently active and notifies
// subscribers (the media manager, the toolbar button itself) when that
// changes.
//
// A "selection type" object looks like:
//   {
//     key: "stl",                       // unique id, e.g. "stl", "image"
//     color: "#ceb8ff",                 // highlight color for matching tiles
//     matches(item): boolean,           // item = { name, isFolder }
//     onPick(item, relPath): void,      // called when a matching FILE tile
//                                        // is clicked; relPath is the file's
//                                        // path relative to the media root
//                                        // (e.g. "fig1.stl" or
//                                        // "sub/fig1.stl")
//   }
//
// The media manager never needs to know anything about "stl" specifically —
// it just asks the active type "does this item match?" and, if so, renders
// the highlight in that type's color and hands off the click.
// ─────────────────────────────────────────────────────────────────────────────

const listeners = new Set();
let activeType = null;

function notify() {
    for (const fn of listeners) fn(activeType);
}

export function startSelection(typeDef) {
    activeType = typeDef;
    notify();
}

export function stopSelection() {
    if (!activeType) return;
    activeType = null;
    notify();
}

// Clicking the same type's button again turns selection mode off; clicking
// a different type's button switches straight to that type.
export function toggleSelection(typeDef) {
    if (activeType && activeType.key === typeDef.key) stopSelection();
    else startSelection(typeDef);
}

export function getActiveSelection() {
    return activeType;
}

export function isSelecting() {
    return activeType !== null;
}

// Returns an unsubscribe function.
export function onSelectionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

// Escape always cancels an active selection, regardless of which panel has
// focus — a global convenience so the user isn't stuck in "picking" mode.
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeType) stopSelection();
});
