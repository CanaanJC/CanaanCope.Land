import { getEndDate } from "./lib-blog.js";

console.log("lib-nav module loaded");

export function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function folderLabel(folderName, metaName) {
    const name = typeof metaName === "string" ? metaName.trim() : "";
    if (name) return name;
    return String(folderName === undefined || folderName === null ? "" : folderName);
}

export function entryId(slugPath) {
    return (Array.isArray(slugPath) ? slugPath : []).join("--");
}

export function libraryUsesDates(library) {
    return !!library && library.useDates === true;
}

export function getEntrySegments(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.slugPath)) return entry.slugPath;
    if (Array.isArray(entry.segments)) return entry.segments;
    return [];
}

export function sortManifestEntries(library, manifest) {
    return Array.isArray(manifest) ? [...manifest] : [];
}

export function entryLabel(entry) {
    const name = entry && typeof entry.name === "string" ? entry.name.trim() : "";
    if (name) return name;
    const segs = getEntrySegments(entry);
    return segs.length ? String(segs[segs.length - 1]) : "";
}

export function entryParentMeta(entry, level) {
    const parents = entry && Array.isArray(entry.parents) ? entry.parents : [];
    return parents[level] || null;
}

export function buildTree(manifest) {
    const root = { slug: null, name: null, children: new Map(), entry: null };

    for (const entry of manifest) {
        const segments = getEntrySegments(entry);
        if (!segments.length) continue;

        let node = root;
        for (let i = 0; i < segments.length; i++) {
            const slug = segments[i];
            if (!node.children.has(slug)) {
                const isLeaf = i === segments.length - 1;
                const meta = isLeaf ? null : entryParentMeta(entry, i);
                node.children.set(slug, {
                    slug,
                    name: isLeaf ? entryLabel(entry) : folderLabel(slug, meta && meta.name),
                    children: new Map(),
                    entry: null,
                });
            }
            node = node.children.get(slug);
        }
        node.entry = entry;
    }

    return root;
}

export function firstLeafSlugPath(node) {
    if (node.entry) return getEntrySegments(node.entry);
    for (const child of node.children.values()) {
        const found = firstLeafSlugPath(child);
        if (found && found.length) return found;
    }
    return null;
}

function collectTreeItems(node, level, out) {
    for (const child of node.children.values()) {
        const isLeaf = child.children.size === 0;
        const slugPath = isLeaf ? getEntrySegments(child.entry) : firstLeafSlugPath(child);

        out.push({
            label: child.name || child.slug,
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
        const parts = String(endDate).split(/[/-]/);
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