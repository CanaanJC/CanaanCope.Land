export const GOOGLE_FONT_PREFIX = "google-font:";

const GOOGLE_FONTS_ICON = "https://www.google.com/s2/favicons?domain=fonts.google.com&sz=64";
const GOOGLE_FONTS_API = "https://www.googleapis.com/webfonts/v1/webfonts";
const SAMPLE_TEXT = "Starship Catch will be so cool!";
const CACHE_TTL = 60 * 60 * 1000;
const ICON_FAMILY_RE = /^material\s+(?:icons?|symbols?)(?:\s|$)/i;
const AXIS_RE = /^[A-Za-z0-9]{4}$/;
const DISPLAY_MODES = ["swap", "auto", "block", "fallback", "optional"];

const DISPLAY_HELP = {
    swap: "Show fallback text immediately, then switch to the downloaded font.",
    auto: "Let the browser choose how text behaves while the font downloads.",
    block: "Briefly hide text while waiting, then show fallback text until the font is ready.",
    fallback: "Show fallback text almost immediately and switch only if the font loads soon.",
    optional: "Use the font if it is ready almost immediately; otherwise keep the fallback.",
};

const FONT_FORMATS = {
    ".otf": "opentype",
    ".ttf": "truetype",
    ".woff": "woff",
    ".woff2": "woff2",
};

const AXIS_LABELS = {
    wght: "Weight",
    wdth: "Width",
    opsz: "Optical size",
    slnt: "Slant",
    ital: "Italic",
    GRAD: "Grade",
    CASL: "Casual",
    CRSV: "Cursive",
    MONO: "Monospace",
    SOFT: "Softness",
    WONK: "Wonky forms",
    XTRA: "Counter width",
    XOPQ: "Thick stroke",
    YOPQ: "Thin stroke",
    YTAS: "Ascender height",
    YTDE: "Descender depth",
    YTFI: "Figure height",
    YTLC: "Lowercase height",
    YTUC: "Uppercase height",
};

const AXIS_START_VALUES = {
    wght: 400,
    wdth: 100,
    opsz: 14,
    slnt: 0,
    ital: 0,
    GRAD: 0,
};

const WEIGHT_LABELS = {
    100: "Thin",
    200: "Extra light",
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "Semibold",
    700: "Bold",
    800: "Extra bold",
    900: "Black",
};

let activePicker = null;
let faceCounter = 0;
let cacheKey = "";
let baseCandidatesPromise = null;

const catalogCache = new Map();
const detailCache = new Map();
const localResolveCache = new Map();
const localFaces = new Map();
const localPreviewTokens = new WeakMap();

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className) {
    const node = el("button", className, text);
    node.type = "button";
    return node;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function rounded(value) {
    return Number(value.toFixed(4));
}

function categoryLabel(value) {
    return String(value || "unknown").replace(/-/g, " ");
}

function familySearchUrl(family) {
    const url = new URL("https://fonts.google.com/");
    if (family) url.searchParams.set("query", family);
    return url.href;
}

function externalLink(text, href, className = "") {
    const link = el("a", className, text);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
}

async function request(url, options = {}, type = "json", timeout = 30000) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abort = () => controller.abort();
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        if (type === "buffer") {
            if (!response.ok) throw new Error(`Font download failed: HTTP ${response.status}`);
            return await response.arrayBuffer();
        }
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.error) {
            const message = typeof data?.error === "string" ? data.error : data?.error?.message;
            throw new Error(message || `HTTP ${response.status}`);
        }
        if (data === null) throw new Error("The server returned an invalid JSON response.");
        return data;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abort);
    }
}

function fontFormat(value) {
    const match = /\.([a-zA-Z0-9]+)$/.exec(String(value ?? "").trim());
    return match ? FONT_FORMATS[`.${match[1].toLowerCase()}`] || null : null;
}

function getBaseCandidates() {
    if (!baseCandidatesPromise) {
        baseCandidatesPromise = request("/api/config")
            .then(config => {
                const bases = [window.location.origin];
                if (config.siteAddress) bases.push(config.siteAddress.replace(/\/$/, ""));
                if (config.hosting?.port) {
                    bases.push(`http://${window.location.hostname}:${config.hosting.port}`);
                }
                return [...new Set(bases)];
            })
            .catch(() => [window.location.origin]);
    }
    return baseCandidatesPromise;
}

async function resolveLocalFont(value) {
    if (/^https?:\/\//i.test(value)) return null;
    const relative = value.replace(/^\//, "");
    for (const base of await getBaseCandidates()) {
        const url = `${base}/${relative}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(url, { method: "HEAD", signal: controller.signal });
            if (response.ok) return url;
        } catch {
        } finally {
            clearTimeout(timer);
        }
    }
    return null;
}

function applyLocalPreview(textarea, value) {
    const token = {};
    localPreviewTokens.set(textarea, token);
    textarea.style.fontFamily = "";
    const format = fontFormat(value);
    if (!format) return;

    const path = String(value ?? "").trim();
    if (!localResolveCache.has(path)) {
        localResolveCache.set(path, resolveLocalFont(path));
    }

    localResolveCache.get(path).then(url => {
        if (!url || localPreviewTokens.get(textarea) !== token) return;
        let record = localFaces.get(url);
        if (!record) {
            const family = `admin-local-font-${faceCounter++}`;
            const style = el("style");
            style.textContent = `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(url)}) format(${JSON.stringify(format)});font-display:swap}`;
            document.head.appendChild(style);
            record = { family, style };
            localFaces.set(url, record);
        }
        textarea.style.fontFamily = `"${record.family}", monospace`;
        const resize = () => {
            if (!textarea.isConnected || localPreviewTokens.get(textarea) !== token) return;
            textarea.style.height = "auto";
            textarea.style.height = `${textarea.scrollHeight}px`;
        };
        resize();
        document.fonts.load(`16px "${record.family}"`).then(resize).catch(() => {});
    });
}

function invalidateLocalFont(path) {
    const trimmed = String(path ?? "").trim();
    const pending = localResolveCache.get(trimmed);
    localResolveCache.delete(trimmed);
    pending?.then(url => {
        const record = localFaces.get(url);
        if (!record) return;
        record.style.remove();
        localFaces.delete(url);
    });
}

export function parseGoogleFont(value) {
    const text = String(value ?? "").trim();
    if (!text.startsWith(GOOGLE_FONT_PREFIX)) return null;

    try {
        const rest = text.slice(GOOGLE_FONT_PREFIX.length);
        const index = rest.indexOf("?");
        const family = decodeURIComponent(index === -1 ? rest : rest.slice(0, index)).trim();
        if (!family) return null;
        const params = new URLSearchParams(index === -1 ? "" : rest.slice(index + 1));
        const axes = {};
        for (const [tag, raw] of params) {
            if (AXIS_RE.test(tag) && raw.trim() && Number.isFinite(Number(raw))) {
                axes[tag] = Number(raw);
            }
        }
        return {
            family,
            axes,
            display: DISPLAY_MODES.includes(params.get("display")) ? params.get("display") : "swap",
        };
    } catch {
        return null;
    }
}

export function serializeGoogleFont(family, axes, display = "swap") {
    const params = new URLSearchParams();
    for (const tag of Object.keys(axes).sort()) {
        if (AXIS_RE.test(tag) && Number.isFinite(axes[tag])) {
            params.set(tag, String(axes[tag]));
        }
    }
    params.set("display", DISPLAY_MODES.includes(display) ? display : "swap");
    return `${GOOGLE_FONT_PREFIX}${encodeURIComponent(family)}?${params}`;
}

function fontVariant(value) {
    const key = String(value || "regular");
    return {
        key,
        weight: Number.parseInt(key, 10) || 400,
        italic: key.includes("italic"),
    };
}

function fontVariants(font) {
    const values = Array.isArray(font?.variants) && font.variants.length
        ? font.variants
        : Object.keys(font?.files || {});
    return values.map(fontVariant)
        .sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight);
}

function nearestVariant(font, weight = 400, italic = false) {
    const variants = fontVariants(font);
    const matching = variants.filter(item => item.italic === italic);
    return (matching.length ? matching : variants).reduce((best, item) => {
        return !best || Math.abs(item.weight - weight) < Math.abs(best.weight - weight) ? item : best;
    }, null);
}

function safeFontUrl(value) {
    try {
        const url = new URL(String(value || "").replace(/^http:/i, "https:"));
        if (url.protocol !== "https:" || url.hostname !== "fonts.gstatic.com") return null;
        return url.href;
    } catch {
        return null;
    }
}

function fontFile(font, weight = 400, italic = false) {
    const variants = Object.keys(font?.files || {}).map(fontVariant);
    const matching = variants.filter(item => item.italic === italic);
    const italicAxis = fontAxes(font).find(axis => axis.tag === "ital");
    const choices = matching.length ? matching : italicAxis ? variants : [];
    const best = choices.reduce((current, item) => {
        return !current || Math.abs(item.weight - weight) < Math.abs(current.weight - weight) ? item : current;
    }, null);
    if (!best) return null;
    const url = safeFontUrl(font.files[best.key]);
    return url ? { ...best, url } : null;
}

function fontAxes(font) {
    return (Array.isArray(font?.axes) ? font.axes : [])
        .filter(axis => AXIS_RE.test(axis.tag)
            && Number.isFinite(Number(axis.start))
            && Number.isFinite(Number(axis.end))
            && Number(axis.start) <= Number(axis.end))
        .map(axis => ({
            tag: axis.tag,
            min: Number(axis.start),
            max: Number(axis.end),
        }));
}

function readNativeAxisDefaults(buffer) {
    const defaults = {};
    try {
        const view = new DataView(buffer);
        if (view.byteLength < 12) return defaults;
        const signature = view.getUint32(0);
        if (signature !== 0x00010000 && signature !== 0x4f54544f) return defaults;
        const count = view.getUint16(4);
        for (let index = 0; index < count; index++) {
            const record = 12 + index * 16;
            if (record + 16 > view.byteLength) break;
            if (view.getUint32(record) !== 0x66766172) continue;
            const start = view.getUint32(record + 8);
            const length = view.getUint32(record + 12);
            if (start + length > view.byteLength || length < 16) break;
            const axesStart = start + view.getUint16(start + 4);
            const axesCount = view.getUint16(start + 8);
            const axisSize = view.getUint16(start + 10);
            if (axisSize < 20) break;
            for (let axisIndex = 0; axisIndex < axesCount; axisIndex++) {
                const offset = axesStart + axisIndex * axisSize;
                if (offset + 20 > start + length) break;
                const tag = String.fromCharCode(
                    view.getUint8(offset),
                    view.getUint8(offset + 1),
                    view.getUint8(offset + 2),
                    view.getUint8(offset + 3)
                );
                if (AXIS_RE.test(tag)) defaults[tag] = view.getInt32(offset + 8) / 65536;
            }
            break;
        }
    } catch {}
    return defaults;
}

function prepareCache(key) {
    if (cacheKey === key) return;
    cacheKey = key;
    catalogCache.clear();
    detailCache.clear();
}

async function googleRequest(key, params, signal) {
    const query = new URLSearchParams(params);
    query.set("key", key);
    return request(`${GOOGLE_FONTS_API}?${query}`, { signal, credentials: "omit" });
}

async function getCatalog(key, sort, signal) {
    const cached = catalogCache.get(sort);
    if (cached && cached.expires > Date.now()) return cached.items;
    const result = await googleRequest(key, { sort, capability: "WOFF2" }, signal);
    if (!Array.isArray(result.items)) throw new Error("Google Fonts returned no font catalogue.");

    const seen = new Set();
    const items = result.items.filter(font => {
        if (!font || typeof font.family !== "string" || !font.family.trim()) return false;
        if (ICON_FAMILY_RE.test(font.family)) return false;
        if (!Object.values(font.files || {}).some(safeFontUrl)) return false;
        if (seen.has(font.family)) return false;
        seen.add(font.family);
        return true;
    });

    if (cacheKey === key && !signal.aborted) {
        catalogCache.set(sort, { items, expires: Date.now() + CACHE_TTL });
    }
    return items;
}

async function getDetails(key, family, signal) {
    const cached = detailCache.get(family);
    if (cached && cached.expires > Date.now()) return cached.font;

    const result = await googleRequest(key, { family, capability: "VF" }, signal);
    const font = result.items?.find(item => item.family === family);
    if (!font) throw new Error("No detailed metadata was returned for this family.");
    if (!Object.values(font.files || {}).some(safeFontUrl)) {
        throw new Error("No usable font files were returned for this family.");
    }

    if (cacheKey === key && !signal.aborted) {
        detailCache.set(family, { font, expires: Date.now() + CACHE_TTL });
        if (detailCache.size > 150) detailCache.delete(detailCache.keys().next().value);
    }
    return font;
}

export function openGoogleFontPicker(field, trigger, commit) {
    activePicker?.();

    const restored = parseGoogleFont(field.getValue());
    const controller = new AbortController();
    const dialog = el("dialog", "admin-gf-dialog");
    dialog.setAttribute("aria-label", "Google Fonts picker");

    const header = el("div", "admin-gf-header");
    const heading = el("div", "admin-gf-heading");
    heading.append(
        el("h2", "", "Google Fonts"),
        el("p", "admin-gf-muted", "Browse, preview and configure a font.")
    );
    const closeButton = button("×", "admin-gf-close");
    closeButton.setAttribute("aria-label", "Close font picker");
    header.append(heading, closeButton);

    const toolbar = el("div", "admin-gf-toolbar");
    const search = el("input", "admin-gf-input");
    search.type = "search";
    search.placeholder = "Search font families…";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "Search font families");

    const sort = el("select", "admin-gf-input admin-gf-sort");
    sort.setAttribute("aria-label", "Sort fonts");
    for (const [value, label] of [
        ["popularity", "Most popular"],
        ["trending", "Trending"],
        ["alpha", "Alphabetical"],
        ["date", "Recently added"],
        ["style", "Most styles"],
    ]) sort.add(new Option(label, value));

    const reloadButton = button("↻", "admin-gf-close");
    reloadButton.title = "Reload catalogue and API key";
    reloadButton.setAttribute("aria-label", reloadButton.title);
    toolbar.append(search, sort, reloadButton);

    const body = el("div", "admin-gf-body");
    const resultsPanel = el("section", "admin-gf-results-panel");
    const count = el("div", "admin-gf-count", "Loading catalogue…");
    count.setAttribute("role", "status");
    const results = el("div", "admin-gf-results");
    results.setAttribute("aria-label", "Font results");
    const list = el("div", "admin-gf-list");
    const more = button("Load more fonts", "admin-gf-more");
    more.hidden = true;
    results.append(list, more);
    resultsPanel.append(count, results);

    const sidebar = el("aside", "admin-gf-sidebar");
    const sampleInput = el("textarea", "admin-gf-input admin-gf-sample-input");
    sampleInput.rows = 3;
    sampleInput.maxLength = 1000;
    sampleInput.value = SAMPLE_TEXT;
    sampleInput.placeholder = SAMPLE_TEXT;
    sampleInput.setAttribute("aria-label", "Preview text");

    const size = el("input", "admin-gf-range");
    size.type = "range";
    size.min = "14";
    size.max = "96";
    size.value = "36";
    size.setAttribute("aria-label", "Preview size");
    const sizeOutput = el("span", "admin-gf-muted", "36 px");

    const category = el("select", "admin-gf-input");
    category.setAttribute("aria-label", "Font category");
    category.add(new Option("All categories", ""));

    const subset = el("select", "admin-gf-input");
    subset.setAttribute("aria-label", "Language or script");
    subset.add(new Option("All languages / scripts", ""));

    function labelled(parent, title, control) {
        const wrap = el("div", "admin-gf-control");
        const label = el("label", "admin-gf-control-label", title);
        if (control.matches("input, select, textarea")) {
            control.id = `admin-gf-control-${faceCounter++}`;
            label.htmlFor = control.id;
        }
        wrap.append(label, control);
        parent.appendChild(wrap);
        return wrap;
    }

    labelled(sidebar, "Preview text", sampleInput);
    labelled(sidebar, "Preview size", size).appendChild(sizeOutput);
    labelled(sidebar, "Category", category);
    labelled(sidebar, "Language / script", subset);
    sidebar.appendChild(el(
        "p",
        "admin-gf-muted admin-gf-filter-note",
        "Material icon families are excluded. Some fonts cover only particular scripts; unsupported characters may use a fallback."
    ));

    const details = el("section", "admin-gf-details");
    details.appendChild(el("p", "admin-gf-muted", "Select a font to configure it."));
    sidebar.appendChild(details);
    body.append(resultsPanel, sidebar);

    const footer = el("div", "admin-gf-footer");
    const footerText = el("div", "admin-gf-footer-text");
    const hint = el("p", "admin-gf-muted");
    const browseLink = externalLink("Google Fonts", familySearchUrl(""));
    hint.append("For a more detailed font search, use ", browseLink, " to find your font.");
    const saveStatus = el("p", "admin-gf-message");
    saveStatus.setAttribute("role", "status");
    footerText.append(hint, saveStatus);
    const useButton = button("Use font", "admin-gf-use");
    useButton.disabled = true;
    footer.append(footerText, useButton);
    dialog.append(header, toolbar, body, footer);
    document.body.appendChild(dialog);

    let closed = false;
    let apiKey = "";
    let catalog = [];
    let filtered = [];
    let rendered = 0;
    let catalogToken = 0;
    let selectionToken = 0;
    let previewToken = 0;
    let filterTimer = null;
    let previewTimer = null;
    let selected = null;
    let selectedDetails = null;
    let selectedPreview = null;
    let selectedNotice = null;
    let descriptor = null;
    let selectionReady = false;
    let saving = false;
    let initialSelectionDone = false;
    let axes = {};
    let axisDefaults = {};
    let selectedDisplay = restored?.display || "swap";
    let outsidePointer = false;
    let activeLoads = 0;

    const queue = [];
    const faces = new Map();
    const cards = new Map();
    const visibleCards = new Set();
    const oldOverflow = document.body.style.overflow;

    function sampleText() {
        return sampleInput.value || SAMPLE_TEXT;
    }

    function message(text, error = false) {
        saveStatus.textContent = text;
        saveStatus.classList.toggle("admin-gf-message--error", error);
    }

    function trimFaces() {
        if (faces.size <= 64) return;
        const protectedKeys = new Set();
        for (const card of visibleCards) {
            const key = cards.get(card)?.faceKey;
            if (key) protectedKeys.add(key);
        }
        if (selectedPreview?.dataset.faceKey) protectedKeys.add(selectedPreview.dataset.faceKey);
        for (const [key, record] of faces) {
            if (faces.size <= 64) break;
            if (!record.loaded || protectedKeys.has(key)) continue;
            document.fonts.delete(record.face);
            faces.delete(key);
        }
    }

    async function loadJob(job) {
        try {
            const buffer = await request(job.url, {
                signal: controller.signal,
                credentials: "omit",
            }, "buffer");
            if (closed) return job.resolve(null);
            const face = new FontFace(job.record.family, buffer, job.descriptors);
            await face.load();
            if (closed) return job.resolve(null);
            document.fonts.add(face);
            job.record.face = face;
            job.record.loaded = true;
            job.record.defaults = readNativeAxisDefaults(buffer);
            job.resolve(job.record);
        } catch {
            if (faces.get(job.key) === job.record) faces.delete(job.key);
            job.resolve(null);
        } finally {
            activeLoads--;
            pumpFonts();
            setTimeout(trimFaces, 0);
        }
    }

    function pumpFonts() {
        while (!closed && activeLoads < 4 && queue.length) {
            const job = queue.shift();
            activeLoads++;
            loadJob(job);
        }
    }

    function requestFace(font, weight, italic, priority = false) {
        const file = fontFile(font, weight, italic);
        if (!file || closed) return Promise.resolve(null);
        const availableAxes = fontAxes(font);
        const weightAxis = availableAxes.find(axis => axis.tag === "wght");
        const widthAxis = availableAxes.find(axis => axis.tag === "wdth");
        const italicAxis = availableAxes.find(axis => axis.tag === "ital");
        const descriptors = {
            style: italicAxis ? (italic ? "italic" : "normal") : file.italic ? "italic" : "normal",
            weight: weightAxis ? `${weightAxis.min} ${weightAxis.max}` : String(file.weight),
            display: "swap",
        };
        if (widthAxis) descriptors.stretch = `${widthAxis.min}% ${widthAxis.max}%`;

        const key = JSON.stringify([file.url, descriptors]);
        const cached = faces.get(key);
        if (cached) {
            faces.delete(key);
            faces.set(key, cached);
            if (priority && !cached.loaded) {
                const index = queue.findIndex(job => job.key === key);
                if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
            }
            return cached.promise;
        }

        let resolvePromise;
        const promise = new Promise(resolve => { resolvePromise = resolve; });
        const record = {
            key,
            family: `admin-google-font-${faceCounter++}`,
            face: null,
            promise,
            loaded: false,
            defaults: {},
        };
        faces.set(key, record);
        const job = { key, record, url: file.url, descriptors, resolve: resolvePromise };
        if (priority) queue.unshift(job);
        else queue.push(job);
        pumpFonts();
        return promise;
    }

    function setPreviewStyle(node, values, italic) {
        node.style.fontSize = `${size.value}px`;
        node.style.fontWeight = String(values.wght ?? 400);
        node.style.fontStyle = italic ? "italic" : "normal";
        node.style.fontStretch = `${values.wdth ?? 100}%`;
        node.style.fontOpticalSizing = "none";
        node.style.fontSynthesis = "none";
        node.style.fontVariationSettings = Object.entries(values)
            .filter(([tag, value]) => AXIS_RE.test(tag) && Number.isFinite(value))
            .map(([tag, value]) => `"${tag}" ${value}`)
            .join(", ") || "normal";
    }

    function loadCard(card) {
        const record = cards.get(card);
        if (!record || closed || record.loading) return;
        if (record.faceKey && faces.get(record.faceKey)?.loaded) return;
        const variant = nearestVariant(record.font);
        if (!variant) {
            record.status.textContent = "No preview style is available.";
            return;
        }

        record.loading = true;
        record.preview.textContent = sampleText();
        record.preview.style.fontSize = `${size.value}px`;
        record.preview.style.fontWeight = String(variant.weight);
        record.preview.style.fontStyle = variant.italic ? "italic" : "normal";
        record.preview.style.fontFamily = "sans-serif";
        record.status.textContent = "Loading preview…";

        requestFace(record.font, variant.weight, variant.italic).then(face => {
            record.loading = false;
            if (closed || !card.isConnected) return;
            if (face) {
                record.faceKey = face.key;
                record.preview.style.fontFamily = `"${face.family}", sans-serif`;
                record.status.textContent = "";
            } else {
                record.status.textContent = "Preview unavailable — select this family to retry.";
            }
        });
    }

    const cardObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                visibleCards.add(entry.target);
                loadCard(entry.target);
            } else {
                visibleCards.delete(entry.target);
            }
        }
        trimFaces();
    }, { root: results, rootMargin: "120px" });

    const moreObserver = new IntersectionObserver(entries => {
        if (!more.hidden && entries.some(entry => entry.isIntersecting)) appendResults();
    }, { root: results, rootMargin: "250px" });

    function updateDescriptor() {
        if (!selected || !descriptor) return;
        const value = serializeGoogleFont(selected.family, axes, selectedDisplay);
        descriptor.textContent = value;
        descriptor.title = value;
    }

    function updateSelectedPreview() {
        if (!selected || !selectedPreview || !selectionReady || closed) return;
        const token = ++previewToken;
        const node = selectedPreview;
        const notice = selectedNotice;
        const values = { ...axes };
        const italic = (values.ital || 0) >= 0.5;
        const metadata = selectedDetails || selected;
        const staticFont = selected;
        node.textContent = sampleText();
        setPreviewStyle(node, values, italic);
        notice.textContent = "Loading configured preview…";
        updateDescriptor();

        requestFace(metadata, values.wght ?? 400, italic, true)
            .then(async face => {
                if (closed || token !== previewToken || node !== selectedPreview) return;
                if (!face && metadata !== staticFont && !fontAxes(metadata).length) {
                    face = await requestFace(staticFont, values.wght ?? 400, italic, true);
                }
                if (closed || token !== previewToken || node !== selectedPreview) return;
                if (face) {
                    node.dataset.faceKey = face.key;
                    node.style.fontFamily = `"${face.family}", sans-serif`;
                    notice.textContent = "";
                    trimFaces();
                } else {
                    delete node.dataset.faceKey;
                    node.style.fontFamily = "sans-serif";
                    notice.textContent = "Font preview failed to load. Showing fallback text.";
                    const retry = button("Retry preview", "admin-gf-inline-button");
                    retry.addEventListener("click", updateSelectedPreview);
                    notice.append(" ", retry);
                }
            });
    }

    function schedulePreview() {
        previewToken++;
        updateDescriptor();
        if (selectedPreview) setPreviewStyle(selectedPreview, axes, (axes.ital || 0) >= 0.5);
        clearTimeout(previewTimer);
        previewTimer = setTimeout(updateSelectedPreview, 140);
    }

    function addStat(parent, name, value) {
        const row = el("div", "admin-gf-stat");
        row.append(el("dt", "", name), el("dd", "", value));
        parent.appendChild(row);
    }

    function buildControls(metadataError = "") {
        details.replaceChildren();
        if (!selected) return;

        const availableAxes = fontAxes(selectedDetails);
        const variants = fontVariants(selected);
        const stats = el("dl", "admin-gf-stats");
        const weightAxis = availableAxes.find(axis => axis.tag === "wght");

        details.append(
            el("h3", "admin-gf-family-title", selected.family),
            externalLink(
                "Find this family on Google Fonts ↗",
                familySearchUrl(selected.family),
                "admin-gf-specimen"
            )
        );

        addStat(stats, "Category", categoryLabel(selected.category));
        addStat(stats, "Styles", String(variants.length));
        addStat(stats, "Font type", availableAxes.length ? "Variable" : metadataError ? "Static controls" : "Static");
        addStat(stats, "Weights", weightAxis
            ? `${weightAxis.min} – ${weightAxis.max}`
            : [...new Set(variants.map(item => item.weight))].join(", "));
        if (selected.version) addStat(stats, "Version", selected.version);
        if (selected.lastModified) addStat(stats, "Updated", selected.lastModified);
        addStat(stats, "Scripts", (selected.subsets || []).join(", ") || "Not provided");
        details.appendChild(stats);

        if (metadataError) {
            details.appendChild(el(
                "p",
                "admin-gf-message admin-gf-message--error",
                `Detailed metadata unavailable: ${metadataError} Available static styles are shown.`
            ));
        }

        selectedPreview = el("div", "admin-gf-selected-preview", sampleText());
        selectedNotice = el("p", "admin-gf-muted");
        details.append(selectedPreview, selectedNotice);

        const styleSelect = el("select", "admin-gf-input");
        const styles = [...new Set(variants.map(item => item.italic ? 1 : 0))];
        const italicAxis = availableAxes.find(axis => axis.tag === "ital");
        if (italicAxis) {
            for (const value of [0, 1]) {
                if (italicAxis.min <= value && italicAxis.max >= value && !styles.includes(value)) {
                    styles.push(value);
                }
            }
        }
        if (!styles.length) styles.push(0);
        styles.sort();

        const desiredItalic = (axes.ital || 0) >= 0.5 ? 1 : 0;
        axes.ital = styles.includes(desiredItalic) ? desiredItalic : styles[0];
        for (const value of styles) {
            styleSelect.add(new Option(value ? "Italic" : "Normal", String(value)));
        }
        styleSelect.value = String(axes.ital);
        styleSelect.disabled = styles.length < 2;
        labelled(details, "Style", styleSelect);

        let weightSelect = null;

        function populateWeights() {
            if (!weightSelect) return;
            weightSelect.replaceChildren();
            const weights = [...new Set(variants
                .filter(item => item.italic === !!axes.ital)
                .map(item => item.weight))];
            if (!weights.length) weights.push(400);
            const desired = axes.wght ?? 400;
            axes.wght = weights.reduce((best, value) => {
                return Math.abs(value - desired) < Math.abs(best - desired) ? value : best;
            }, weights[0]);
            for (const weight of weights) {
                weightSelect.add(new Option(
                    `${weight}${WEIGHT_LABELS[weight] ? ` — ${WEIGHT_LABELS[weight]}` : ""}`,
                    String(weight)
                ));
            }
            weightSelect.value = String(axes.wght);
            weightSelect.disabled = weights.length < 2;
        }

        if (!weightAxis) {
            weightSelect = el("select", "admin-gf-input");
            populateWeights();
            labelled(details, "Weight", weightSelect);
            weightSelect.addEventListener("change", () => {
                axes.wght = Number(weightSelect.value);
                schedulePreview();
            });
        }

        styleSelect.addEventListener("change", () => {
            axes.ital = Number(styleSelect.value);
            populateWeights();
            schedulePreview();
        });

        for (const axis of availableAxes.filter(item => item.tag !== "ital")) {
            const controls = el("div", "admin-gf-axis-controls");
            const slider = el("input", "admin-gf-range");
            slider.type = "range";
            slider.min = String(axis.min);
            slider.max = String(axis.max);
            slider.step = "any";
            slider.setAttribute("aria-label", AXIS_LABELS[axis.tag] || axis.tag);

            const number = el("input", "admin-gf-input admin-gf-axis-number");
            number.type = "number";
            number.min = String(axis.min);
            number.max = String(axis.max);
            number.step = "any";
            number.setAttribute("aria-label", `${AXIS_LABELS[axis.tag] || axis.tag} value`);
            slider.value = number.value = String(axes[axis.tag]);
            controls.append(slider, number);

            const wrap = labelled(details, `${AXIS_LABELS[axis.tag] || axis.tag} (${axis.tag})`, controls);
            wrap.appendChild(el("span", "admin-gf-muted", `${axis.min} – ${axis.max}`));

            function setAxis(value, syncNumber = true) {
                if (!Number.isFinite(value)) return;
                axes[axis.tag] = rounded(clamp(value, axis.min, axis.max));
                slider.value = String(axes[axis.tag]);
                if (syncNumber) number.value = String(axes[axis.tag]);
                schedulePreview();
            }

            slider.addEventListener("input", () => setAxis(Number(slider.value)));
            number.addEventListener("input", () => {
                const value = number.valueAsNumber;
                if (Number.isFinite(value) && value >= axis.min && value <= axis.max) {
                    setAxis(value, false);
                }
            });
            number.addEventListener("change", () => {
                if (Number.isFinite(number.valueAsNumber)) setAxis(number.valueAsNumber);
                else number.value = String(axes[axis.tag]);
            });
            number.addEventListener("blur", () => {
                number.value = String(axes[axis.tag]);
            });
        }

        if (availableAxes.length) {
            const unknownDefaults = availableAxes.filter(axis => {
                return !Number.isFinite(axisDefaults[axis.tag]);
            });
            const reset = button("Reset axes", "admin-gf-secondary");
            reset.addEventListener("click", () => {
                for (const axis of availableAxes) {
                    const value = axisDefaults[axis.tag]
                        ?? AXIS_START_VALUES[axis.tag]
                        ?? (axis.min + axis.max) / 2;
                    axes[axis.tag] = rounded(clamp(value, axis.min, axis.max));
                }
                buildControls(metadataError);
            });
            details.appendChild(reset);
            if (unknownDefaults.length) {
                details.appendChild(el(
                    "p",
                    "admin-gf-muted",
                    "Where native defaults are unavailable, axes start at common values or the middle of their range."
                ));
            }
        }

        const displaySelect = el("select", "admin-gf-input");
        for (const value of DISPLAY_MODES) {
            displaySelect.add(new Option(value === "swap" ? "swap — recommended" : value, value));
        }
        displaySelect.value = selectedDisplay;
        labelled(details, "Font display", displaySelect);
        const displayHelp = el("p", "admin-gf-muted", DISPLAY_HELP[selectedDisplay]);
        details.appendChild(displayHelp);
        displaySelect.addEventListener("change", () => {
            selectedDisplay = displaySelect.value;
            displayHelp.textContent = DISPLAY_HELP[selectedDisplay];
            updateDescriptor();
        });

        descriptor = el("code", "admin-gf-descriptor");
        details.appendChild(descriptor);
        updateDescriptor();
        updateSelectedPreview();
    }

    async function selectFont(font, saved = null) {
        if (saving || closed) return;
        const token = ++selectionToken;
        previewToken++;
        clearTimeout(previewTimer);
        selected = font;
        selectedDetails = null;
        selectedPreview = null;
        selectedNotice = null;
        descriptor = null;
        selectionReady = false;
        axisDefaults = {};
        useButton.disabled = true;
        useButton.textContent = "Use font";
        message("");
        details.replaceChildren(
            el("h3", "admin-gf-family-title", font.family),
            el("p", "admin-gf-muted", "Loading font configuration…")
        );

        for (const [card, record] of cards) {
            const active = record.font.family === font.family;
            card.classList.toggle("admin-gf-card--selected", active);
            card.setAttribute("aria-pressed", String(active));
        }

        const initial = saved?.axes || {};
        const variant = nearestVariant(font, initial.wght ?? 400, (initial.ital || 0) >= 0.5);
        let metadata = null;
        let metadataError = "";

        try {
            metadata = await getDetails(apiKey, font.family, controller.signal);
        } catch (error) {
            if (closed || token !== selectionToken) return;
            metadataError = error.name === "AbortError" ? "Request timed out." : error.message;
        }
        if (closed || token !== selectionToken) return;

        let defaults = {};
        if (fontAxes(metadata).length) {
            const face = await requestFace(
                metadata,
                initial.wght ?? variant?.weight ?? 400,
                variant?.italic || false,
                true
            );
            if (closed || token !== selectionToken) return;
            defaults = face?.defaults || {};
        }

        selectedDetails = metadata;
        axisDefaults = defaults;
        axes = { wght: variant?.weight || 400, ital: variant?.italic ? 1 : 0 };
        selectedDisplay = saved?.display || "swap";

        for (const axis of fontAxes(metadata)) {
            const value = Number.isFinite(initial[axis.tag])
                ? initial[axis.tag]
                : defaults[axis.tag] ?? AXIS_START_VALUES[axis.tag] ?? (axis.min + axis.max) / 2;
            axes[axis.tag] = rounded(clamp(value, axis.min, axis.max));
        }

        if (Number.isFinite(initial.ital)) axes.ital = initial.ital >= 0.5 ? 1 : 0;
        selectionReady = true;
        useButton.disabled = false;
        buildControls(metadataError);
    }

    function buildCard(font) {
        const card = button("", "admin-gf-card");
        card.setAttribute("aria-label", `Configure ${font.family}`);
        const active = selected?.family === font.family;
        card.setAttribute("aria-pressed", String(active));
        card.classList.toggle("admin-gf-card--selected", active);

        const top = el("div", "admin-gf-card-top");
        top.append(
            el("strong", "admin-gf-card-family", font.family),
            el("span", "admin-gf-muted", `${categoryLabel(font.category)} · ${fontVariants(font).length} styles`)
        );
        const preview = el("div", "admin-gf-card-preview", sampleText());
        preview.style.fontSize = `${size.value}px`;
        const status = el("span", "admin-gf-preview-status");
        card.append(top, preview, status);
        cards.set(card, { font, preview, status, faceKey: "", loading: false });

        card.addEventListener("click", () => {
            if (selected?.family === font.family && selectionReady) {
                updateSelectedPreview();
                return;
            }
            selectFont(font, restored?.family === font.family ? restored : null);
        });
        cardObserver.observe(card);
        return card;
    }

    function appendResults() {
        if (closed || rendered >= filtered.length) return;
        const end = Math.min(rendered + 24, filtered.length);
        const fragment = document.createDocumentFragment();
        for (; rendered < end; rendered++) fragment.appendChild(buildCard(filtered[rendered]));
        list.appendChild(fragment);
        more.hidden = rendered >= filtered.length;
        count.textContent = `${filtered.length.toLocaleString()} families · ${rendered.toLocaleString()} shown`;
    }

    function filterResults() {
        clearTimeout(filterTimer);
        const query = search.value.trim().toLocaleLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);
        browseLink.href = familySearchUrl(search.value.trim());

        filtered = catalog.filter(font => {
            const family = font.family.toLocaleLowerCase();
            return terms.every(term => family.includes(term))
                && (!category.value || font.category === category.value)
                && (!subset.value || (font.subsets || []).includes(subset.value));
        });

        cardObserver.disconnect();
        visibleCards.clear();
        cards.clear();
        list.replaceChildren();
        rendered = 0;
        results.scrollTop = 0;

        if (!filtered.length) {
            const text = ICON_FAMILY_RE.test(search.value.trim())
                ? "Material Icons and Material Symbols are icon fonts, not text families."
                : catalog.length ? "No fonts match these filters." : "No fonts available.";
            list.appendChild(el("p", "admin-gf-empty", text));
            count.textContent = "0 families";
            more.hidden = true;
            return;
        }

        appendResults();
    }

    function populateFilters() {
        const previousCategory = category.value;
        const previousSubset = subset.value;
        category.replaceChildren(new Option("All categories", ""));
        subset.replaceChildren(new Option("All languages / scripts", ""));

        const categories = [...new Set(catalog.map(font => font.category).filter(Boolean))].sort();
        const subsets = [...new Set(catalog.flatMap(font => font.subsets || []))].sort();

        for (const value of categories) category.add(new Option(categoryLabel(value), value));
        for (const value of subsets) subset.add(new Option(value.replace(/-/g, " "), value));
        if (categories.includes(previousCategory)) category.value = previousCategory;
        if (subsets.includes(previousSubset)) subset.value = previousSubset;
    }

    async function loadCatalog(refresh = false) {
        const token = ++catalogToken;
        sort.disabled = true;
        reloadButton.disabled = true;
        count.textContent = "Loading catalogue…";
        message("");

        try {
            if (!apiKey || refresh) {
                const config = await request("/api/config", {
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (closed || token !== catalogToken) return;
                const newKey = typeof config.apiKeys?.googleFonts === "string"
                    ? config.apiKeys.googleFonts.trim()
                    : "";
                if (!newKey) {
                    throw new Error("Set apiKeys.googleFonts in config/master.json, save it, then reload the catalogue.");
                }
                apiKey = newKey;
                prepareCache(apiKey);
            }

            if (refresh) {
                catalogCache.clear();
                detailCache.clear();
            }

            const items = await getCatalog(apiKey, sort.value, controller.signal);
            if (closed || token !== catalogToken) return;
            catalog = items;
            populateFilters();
            filterResults();

            if (!initialSelectionDone) {
                initialSelectionDone = true;
                if (restored) {
                    if (ICON_FAMILY_RE.test(restored.family)) {
                        message(`"${restored.family}" is an icon font. Choose a text family to replace it.`, true);
                    } else {
                        const match = catalog.find(font => font.family.toLocaleLowerCase() === restored.family.toLocaleLowerCase());
                        if (match) selectFont(match, restored);
                        else message(`The saved family "${restored.family}" is not in the current catalogue.`, true);
                    }
                }
            } else if (refresh && selected && !saving) {
                const match = catalog.find(font => font.family === selected.family);
                if (match) {
                    selectFont(match, { axes: { ...axes }, display: selectedDisplay });
                } else {
                    selectionToken++;
                    previewToken++;
                    selected = null;
                    selectedDetails = null;
                    selectedPreview = null;
                    selectedNotice = null;
                    selectionReady = false;
                    useButton.disabled = true;
                    details.replaceChildren(el("p", "admin-gf-muted", "Select a font to configure it."));
                    message("The previously selected family is no longer in the catalogue.", true);
                }
            }
        } catch (error) {
            if (closed || token !== catalogToken) return;
            count.textContent = catalog.length
                ? `${catalog.length.toLocaleString()} families · reload failed`
                : "Catalogue unavailable";
            message(error.name === "AbortError"
                ? "The request timed out. Try reloading the catalogue."
                : error.message, true);
        } finally {
            if (!closed && token === catalogToken) {
                sort.disabled = false;
                reloadButton.disabled = false;
            }
        }
    }

    function close() {
        if (closed) return;
        closed = true;
        controller.abort();
        clearTimeout(filterTimer);
        clearTimeout(previewTimer);
        cardObserver.disconnect();
        moreObserver.disconnect();
        for (const job of queue.splice(0)) job.resolve(null);
        for (const record of faces.values()) {
            if (record.loaded) document.fonts.delete(record.face);
        }
        faces.clear();
        cards.clear();
        visibleCards.clear();
        document.body.style.overflow = oldOverflow;
        if (dialog.open) dialog.close();
        dialog.remove();
        if (activePicker === close) activePicker = null;
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }

    function outside(event) {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom;
    }

    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", event => {
        event.preventDefault();
        event.stopPropagation();
        close();
    });
    dialog.addEventListener("close", close);
    dialog.addEventListener("pointerdown", event => {
        outsidePointer = outside(event);
    });
    dialog.addEventListener("pointercancel", () => {
        outsidePointer = false;
    });
    dialog.addEventListener("click", event => {
        if (outsidePointer && outside(event)) close();
        outsidePointer = false;
    });
    dialog.addEventListener("keydown", event => {
        if (event.key === "Escape") event.stopPropagation();
    });

    search.addEventListener("input", () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(filterResults, 120);
    });
    category.addEventListener("change", filterResults);
    subset.addEventListener("change", filterResults);
    sort.addEventListener("change", () => loadCatalog());
    reloadButton.addEventListener("click", () => loadCatalog(true));
    more.addEventListener("click", appendResults);

    function refreshSample() {
        for (const record of cards.values()) {
            record.preview.textContent = sampleText();
            record.preview.style.fontSize = `${size.value}px`;
        }
        if (selectedPreview) {
            selectedPreview.textContent = sampleText();
            selectedPreview.style.fontSize = `${size.value}px`;
        }
        sizeOutput.textContent = `${size.value} px`;
    }

    sampleInput.addEventListener("input", refreshSample);
    size.addEventListener("input", refreshSample);

    useButton.addEventListener("click", async () => {
        if (!selected || !selectionReady || saving || closed) return;
        saving = true;
        useButton.disabled = true;
        useButton.textContent = "Saving…";
        message("Saving font configuration…");
        sidebar.inert = true;
        resultsPanel.inert = true;
        toolbar.inert = true;
        const value = serializeGoogleFont(selected.family, axes, selectedDisplay);

        try {
            const result = await commit(value);
            if (!result?.ok) throw new Error(result?.error || "The font configuration could not be saved.");
            if (!closed) close();
        } catch (error) {
            if (!closed) {
                message(`Save failed: ${error.message}`, true);
                useButton.disabled = false;
                useButton.textContent = "Retry save";
            }
        } finally {
            saving = false;
            if (!closed) {
                sidebar.inert = false;
                resultsPanel.inert = false;
                toolbar.inert = false;
            }
        }
    });

    activePicker = close;
    try {
        dialog.showModal();
        document.body.style.overflow = "hidden";
        moreObserver.observe(more);
        search.focus();
        loadCatalog();
    } catch (error) {
        close();
        throw error;
    }
}

export function attachFontUpload(row, field, onFontPick) {
    row.classList.add("admin-field-row--font");

    function refreshPreview() {
        const textarea = row.querySelector(".admin-field-input-text");
        if (textarea) applyLocalPreview(textarea, field.getValue());
    }

    requestAnimationFrame(refreshPreview);
    row.addEventListener("input", refreshPreview);

    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.accept = ".ttf,.otf,.woff,.woff2";
    fileInput.hidden = true;

    const uploadButton = button("⬆", "admin-font-upload-btn");
    uploadButton.title = "Upload font file (.ttf, .otf, .woff, .woff2)";
    uploadButton.setAttribute("aria-label", uploadButton.title);
    uploadButton.addEventListener("click", () => fileInput.click());

    const googleButton = button("", "admin-google-font-btn");
    googleButton.title = "Browse Google Fonts";
    googleButton.setAttribute("aria-label", googleButton.title);
    const icon = el("img");
    icon.alt = "";
    icon.width = 20;
    icon.height = 20;
    icon.referrerPolicy = "no-referrer";
    icon.src = GOOGLE_FONTS_ICON;
    icon.addEventListener("error", () => {
        googleButton.replaceChildren(el("span", "admin-google-font-fallback", "G"));
    }, { once: true });
    googleButton.appendChild(icon);

    googleButton.addEventListener("click", () => {
        openGoogleFontPicker(field, googleButton, async value => {
            field.setValue(value);
            refreshPreview();
            return onFontPick();
        });
    });

    async function doUpload(file, oldFilename, deleteOld) {
        uploadButton.disabled = true;
        googleButton.disabled = true;
        try {
            const params = new URLSearchParams({
                filename: file.name,
                deleteOld: deleteOld ? "true" : "false",
            });
            if (oldFilename) params.set("oldFilename", oldFilename);
            const data = await request(`/api/upload/font?${params}`, {
                method: "POST",
                headers: { "Content-Type": file.type || "application/octet-stream" },
                body: await file.arrayBuffer(),
            });
            invalidateLocalFont(data.path);
            field.setValue(data.path);
            refreshPreview();
        } catch (error) {
            alert(`Font upload failed: ${error.message}`);
        } finally {
            uploadButton.disabled = false;
            googleButton.disabled = false;
        }
    }

    fileInput.addEventListener("change", () => {
        const file = fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        const oldValue = String(field.getValue() || "").trim();
        const oldFilename = fontFormat(oldValue) && !oldValue.startsWith(GOOGLE_FONT_PREFIX)
            ? oldValue.split(/[\\/]+/).pop()
            : "";

        if (!oldFilename) {
            doUpload(file, "", false);
        } else if (oldFilename.toLowerCase() === file.name.toLowerCase()) {
            if (confirm(`"${oldFilename}" already exists. Overwrite it?`)) {
                doUpload(file, oldFilename, false);
            }
        } else {
            doUpload(file, oldFilename, confirm(`A different font file already exists ("${oldFilename}"). Delete it?`));
        }
    });

    const tools = el("div", "admin-font-tools");
    tools.append(uploadButton, googleButton, fileInput);
    row.appendChild(tools);
}