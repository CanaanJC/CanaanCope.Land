import { getEndDate, sortByEndDate } from "./lib-blog.js";

console.log("lib-nav module loaded");

export function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function splitFolderName(folderName) {
    const raw = folderName === undefined || folderName === null ? "" : String(folderName);
    const idx = raw.indexOf("_");
    if (idx === -1) return { prefix: raw, label: raw, raw };
    return { prefix: raw.slice(0, idx), label: raw.slice(idx + 1), raw };
}

export function folderLabel(folderName) {
    return splitFolderName(folderName).label;
}

export function compareFolderNames(a, b) {
    const A = splitFolderName(a);
    const B = splitFolderName(b);
    let c = naturalCompare(A.prefix, B.prefix);
    if (c !== 0) return c;
    c = naturalCompare(A.label, B.label);
    if (c !== 0) return c;
    return naturalCompare(A.raw, B.raw);
}

export function entryId(slugPath) {
    return slugPath.join("--");
}

export function libraryUsesDates(library) {
    return !!library && library.useDates === true;
}

export function getEntrySegments(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.slugPath)) return entry.slugPath;
    if (Array.isArray(entry.segments)) {
        return entry.segments.map(s => (typeof s === "string" ? s : s && s.slug));
    }
    return [];
}

export function compareEntries(a, b) {
    const sa = getEntrySegments(a);
    const sb = getEntrySegments(b);
    const len = Math.max(sa.length, sb.length);
    for (let i = 0; i < len; i++) {
        if (sa[i] === undefined) return -1;
        if (sb[i] === undefined) return 1;
        const c = compareFolderNames(sa[i], sb[i]);
        if (c !== 0) return c;
    }
    return 0;
}

export function sortManifestEntries(library, manifest) {
    if (!Array.isArray(manifest)) return [];
    if (libraryUsesDates(library)) return sortByEndDate(manifest);
    return [...manifest].sort(compareEntries);
}

export function buildTree(manifest) {
    const root = { slug: null, children: new Map(), entry: null };
    for (const entry of manifest) {
        const segments = getEntrySegments(entry);
        if (!segments.length) continue;
        let node = root;
        for (const slug of segments) {
            if (!node.children.has(slug)) {
                node.children.set(slug, { slug, children: new Map(), entry: null });
            }
            node = node.children.get(slug);
        }
        node.entry = entry;
    }
    return root;
}

function sortedChildren(node) {
    return [...node.children.values()].sort((a, b) => compareFolderNames(a.slug, b.slug));
}

export function firstLeafSlugPath(node) {
    if (node.entry) return getEntrySegments(node.entry);
    for (const child of sortedChildren(node)) {
        const found = firstLeafSlugPath(child);
        if (found && found.length) return found;
    }
    return null;
}

function nodeLabel(node) {
    if (node.entry) {
        const name = node.entry.name;
        if (typeof name === "string" && name.trim() !== "") return name;
    }
    return folderLabel(node.slug);
}

function collectTreeItems(node, level, out) {
    for (const child of sortedChildren(node)) {
        const isLeaf = child.children.size === 0;
        const slugPath = isLeaf ? getEntrySegments(child.entry) : firstLeafSlugPath(child);

        out.push({
            label: nodeLabel(child),
            level,
            isLeaf,
            targetId: slugPath && slugPath.length ? entryId(slugPath) : null,
        });

        if (!isLeaf) collectTreeItems(child, level + 1, out);
    }
}

export function buildTreeNavItems(sortedManifest) {
    const out = [];
    collectTreeItems(buildTree(sortedManifest), 0, out);
    return out;
}

export function buildDateNavItems(sortedManifest) {
    const yearToId = new Map();
    const monthToId = new Map();
    const yearMonths = new Map();

    for (const entry of sortedManifest) {
        const endDate = getEndDate(entry.date);
        if (!endDate) continue;
        const parts = String(endDate).split("/");
        if (parts.length < 2) continue;
        const year = parts[0];
        const month = parts[1].padStart(2, "0");
        const key = `${year}/${month}`;
        const id = entryId(getEntrySegments(entry));
        if (!yearToId.has(year)) yearToId.set(year, id);
        if (!monthToId.has(key)) monthToId.set(key, id);
        if (!yearMonths.has(year)) yearMonths.set(year, new Set());
        yearMonths.get(year).add(month);
    }

    const out = [];
    const years = [...yearMonths.keys()].sort((a, b) => Number(b) - Number(a));

    for (const year of years) {
        out.push({
            label: year,
            level: 0,
            isLeaf: false,
            targetId: yearToId.get(year) || null,
        });

        const months = [...yearMonths.get(year)].sort((a, b) => Number(b) - Number(a));
        for (const month of months) {
            out.push({
                label: month,
                level: 1,
                isLeaf: true,
                targetId: monthToId.get(`${year}/${month}`) || null,
            });
        }
    }

    return out;
}

export function buildNavItems(library, sortedManifest) {
    return libraryUsesDates(library)
        ? buildDateNavItems(sortedManifest)
        : buildTreeNavItems(sortedManifest);
}

export function navTriggerLabel(library, contentsTitle) {
    return libraryUsesDates(library) ? "By Month" : (contentsTitle || "Contents");
}
