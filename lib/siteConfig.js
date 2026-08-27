const fs = require("fs");
const path = require("path");

const CONFIG_DIR     = path.join(__dirname, "..", "config");
const DEFAULTS_PATH  = path.join(CONFIG_DIR, "defaults.json");
const MASTER_PATH    = path.join(CONFIG_DIR, "master.json");
const LIBRARIES_PATH = path.join(CONFIG_DIR, "libraries.json");

const HARD_FALLBACK_DEFAULTS = {
    siteName: "MyPage",
    siteAddress: "https://mypage.ca",
    slogan: "This is my amazing page!",
    bottomText: "",
    hosting: {
        host: "0.0.0.0",
        port: 9138,
        adminPort: 9832,
    },
    webhooks: {
        notFound: "",
        backup: "",
    },
    backup: {
        path: "",
        interval: "monthly",
        time: "00:00",
        enabled: false,
        lanIp: "",
    },
    archive: {
        maxConcurrentInstances: 3,
        idleTimeoutMinutes: 10,
        maxRuntimeMinutes: 60,
    },
    theme: {
        backgroundColor: "#181818",
        page: {
            font: "",
            textColor: "#eaeaea",
            code: {
                backgroundColor: "#252525",
                borderColor: "#333333",
                textColor: "#eaeaea",
                blockBackgroundColor: "#1e1e1e",
                blockBorderColor: "#2e2e2e",
            },
        },
        topbar: {
            backgroundColor: "#202020",
            depth: 56,
            icon: "/media/logo.png",
            slogan: {
                font: "",
                fontSize: 20,
                color: "#bdbdbd",
            },
        },
        sidebar: {
            backgroundColor: "#202020",
            collapsedWidth: 64,
            expandedWidth: 320,
        },
        bottomText: {
            font: "",
            fontSize: 15,
            color: "#eaeaea",
        },
    },
};

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return fallback;
    }
}

function writeJsonSafe(filePath, data) {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        return true;
    } catch (e) {
        console.error(`[siteConfig] failed to write ${filePath}: ${e.message}`);
        return false;
    }
}

function deepMerge(base, override) {
    if (override === undefined) return base;
    const baseIsObj     = base     && typeof base     === "object" && !Array.isArray(base);
    const overrideIsObj = override && typeof override === "object" && !Array.isArray(override);
    if (!baseIsObj || !overrideIsObj) return override;

    const result = { ...base };
    for (const key of Object.keys(override)) {
        result[key] = deepMerge(base[key], override[key]);
    }
    return result;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null) return false;
    if (typeof a !== "object") return false;
    const keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
}

function getDefaults() {
    const existing = readJsonSafe(DEFAULTS_PATH, null);
    if (existing) return existing;
    writeJsonSafe(DEFAULTS_PATH, HARD_FALLBACK_DEFAULTS);
    return HARD_FALLBACK_DEFAULTS;
}

function ensureMasterConfig() {
    const defaults      = getDefaults();
    const existingMaster = readJsonSafe(MASTER_PATH, null);
    const merged         = deepMerge(defaults, existingMaster || {});

    if (!existingMaster || !deepEqual(existingMaster, merged)) {
        if (writeJsonSafe(MASTER_PATH, merged)) {
            console.log(existingMaster
                ? "[siteConfig] master.json was missing fields — filled in with defaults"
                : "[siteConfig] master.json was missing — created from defaults");
        }
    }

    return merged;
}

function getFullConfig() {
    const defaults = getDefaults();
    const master   = readJsonSafe(MASTER_PATH, {});
    return deepMerge(defaults, master);
}

function saveMasterConfig(data) {
    return writeJsonSafe(MASTER_PATH, data);
}

function getSiteInfo() {
    const { siteName, siteAddress, slogan, bottomText } = getFullConfig();
    return { siteName, siteAddress, slogan, bottomText };
}

function getTheme() {
    return getFullConfig().theme;
}

function getWebhooks() {
    return getFullConfig().webhooks;
}

function getBackupConfig() {
    return getFullConfig().backup;
}

function getArchiveConfig() {
    return getFullConfig().archive;
}

function getHostingConfig() {
    return getFullConfig().hosting;
}

// `hidden` controls only whether a library appears in nav dropdowns
// (topbar "Projects" dropdown, mobile menu flat list). Everything else —
// routing, manifests, media listings, embeds, and featured-entry eligibility
// — is completely unaffected by it. Missing/omitted `hidden` on an existing
// libraries.json entry is treated as `false` (visible), so older configs
// keep behaving exactly as before.
function getLibraries() {
    const list = readJsonSafe(LIBRARIES_PATH, []);
    if (!Array.isArray(list)) return [];
    return list
        .filter(lib =>
            lib &&
            typeof lib.path === "string" && lib.path.length > 0 &&
            Number.isInteger(lib.depth) && lib.depth >= 1
        )
        .map(lib => ({ ...lib, hidden: lib.hidden === true }));
}

function getLibrariesRaw() {
    const list = readJsonSafe(LIBRARIES_PATH, []);
    return Array.isArray(list) ? list : [];
}

function saveLibraries(list) {
    if (!Array.isArray(list)) return false;
    return writeJsonSafe(LIBRARIES_PATH, list);
}

function getLibraryByPath(segment) {
    return getLibraries().find(lib => lib.path === segment) || null;
}

function getLibraryById(id) {
    return getLibraries().find(lib => lib.id === id) || null;
}

module.exports = {
    CONFIG_DIR,
    DEFAULTS_PATH,
    MASTER_PATH,
    LIBRARIES_PATH,
    ensureMasterConfig,
    getFullConfig,
    saveMasterConfig,
    getSiteInfo,
    getTheme,
    getWebhooks,
    getBackupConfig,
    getArchiveConfig,
    getHostingConfig,
    getLibraries,
    getLibrariesRaw,
    saveLibraries,
    getLibraryByPath,
    getLibraryById,
};
