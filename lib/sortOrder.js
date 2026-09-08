const FIRST_TOKEN = "first_blog";

function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function normGoAfter(value) {
    return typeof value === "string" ? value.trim() : "";
}

function orderByGoAfter(items) {
    const list = Array.isArray(items) ? items.slice() : [];
    if (list.length <= 1) return list;

    const byKey = new Map();
    for (const item of list) byKey.set(item.key, item);

    const specified = [];
    const unspecified = [];

    for (const item of list) {
        const ga = normGoAfter(item.goAfter);
        if (ga === FIRST_TOKEN) {
            specified.push(item);
        } else if (ga && ga !== item.key && byKey.has(ga)) {
            specified.push(item);
        } else {
            unspecified.push(item);
        }
    }

    const childrenOf = new Map();
    for (const item of specified) {
        const key = normGoAfter(item.goAfter);
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key).push(item);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => naturalCompare(a.key, b.key));

    unspecified.sort((a, b) => naturalCompare(a.key, b.key));

    const out = [];
    const placed = new Set();

    function emit(item) {
        if (placed.has(item.key)) return;
        placed.add(item.key);
        out.push(item);
        const kids = childrenOf.get(item.key) || [];
        for (const kid of kids) emit(kid);
    }

    for (const item of childrenOf.get(FIRST_TOKEN) || []) emit(item);
    for (const item of unspecified) emit(item);
    for (const item of specified) emit(item);

    return out;
}

function getEndDate(date) {
    if (!date) return null;
    if (Array.isArray(date)) return date.length > 0 ? date[date.length - 1] : null;
    return date;
}

function parseFlexibleDate(dateStr) {
    if (typeof dateStr !== "string") return null;
    const parts = dateStr.trim().split(/[/-]/);
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(n => parseInt(n, 10));
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
}

function orderDated(items) {
    const dated = [];
    const undated = [];

    for (const item of items) {
        const parsed = parseFlexibleDate(getEndDate(item.date));
        if (parsed) dated.push({ item, parsed });
        else undated.push(item);
    }

    dated.sort((a, b) => b.parsed - a.parsed);

    return [...dated.map(d => d.item), ...orderByGoAfter(undated)];
}

function orderSiblings(items, useDates) {
    if (useDates) return orderDated(items);
    return orderByGoAfter(items);
}

module.exports = {
    FIRST_TOKEN,
    naturalCompare,
    normGoAfter,
    orderByGoAfter,
    orderDated,
    orderSiblings,
    getEndDate,
    parseFlexibleDate,
};