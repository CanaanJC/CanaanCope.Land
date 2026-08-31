
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

export function onSelectionChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && activeType) stopSelection();
});
