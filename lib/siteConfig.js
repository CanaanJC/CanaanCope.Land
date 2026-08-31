const fs = require("fs");
const path = require("path");

const CONFIG_DIR     = path.join(__dirname, "..", "config");
const DEFAULTS_PATH  = path.join(CONFIG_DIR, "defaults.json");
const MASTER_PATH    = path.join(CONFIG_DIR, "master.json");
const LIBRARIES_PATH = path.join(CONFIG_DIR, "libraries.json");
const BACKUP_DIR     = path.join(CONFIG_DIR, "backup");

const HARD_FALLBACK_DEFAULTS = {
    siteName: "MyPage",
    siteAddress: "https://mypage.ca",
    slogan: "This is my amazing page!",
    bottomText: "",
    hosting: {
        host: "0.0.0.0",
        port: 2138,
        adminPort: 1832,
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
        master: {
            backgroundColor: "#181818",
            font: "",
            fontSize: 16,
            textColor: "#eaeaea",
        },
        topbar: {
            backgroundColor: "#202020",
            font: "",
            fontSize: 20,
            textColor: "#eaeaea",
            depth: 56,
            icon: "/media/logo.png",
            slogan: {
                font: "",
                fontSize: 20,
                textColor: "#bdbdbd",
            },
        },
        sidebar: {
            backgroundColor: "#202020",
            font: "",
            fontSize: 14,
            textColor: "#eaeaea",
            collapsedWidth: 64,
            expandedWidth: 320,
            iconSize: 36,
        },
        body: {
            backgroundColor: "#181818",
            font: "",
            fontSize: 16,
            textColor: "#eaeaea",
        },
        bottomText: {
            font: "",
            fontSize: 15,
            textColor: "#eaeaea",
        },
        code: {
            backgroundColor: "#252525",
            borderColor: "#333333",
            textColor: "#eaeaea",
            blockBackgroundColor: "#1e1e1e",
            blockBorderColor: "#2e2e2e",
            font: "",
            fontSize: 14,
        },
    },
};

const NUMERIC_KEYS = new Set([
    "fontSize",
    "depth",
    "collapsedWidth",
    "expandedWidth",
    "iconSize",
]);

function coerceNumericStrings(value) {
    if (Array.isArray(value)) {
        return value.map(coerceNumericStrings);
    }
    if (value && typeof value === "object") {
        const result = {};
        for (const [key, v] of Object.entries(value)) {
            if (
                NUMERIC_KEYS.has(key) &&
                typeof v === "string" &&
                v.trim() !== "" &&
                !isNaN(Number(v))
            ) {
                result[key] = Number(v);
            } else {
                result[key] = coerceNumericStrings(v);
            }
        }
        return result;
    }
    return value;
}

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return fallback;
    }
}

function writeJsonSafe(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });

        const coerced = coerceNumericStrings(data);
        const json    = JSON.stringify(coerced, null, 4);
        const tmpPath = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);

        fs.writeFileSync(tmpPath, json);
        fs.renameSync(tmpPath, filePath);
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

function pad(n) {
    return String(n).padStart(2, "0");
}

function timestampForBackupFilename(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function backupMasterBeforeMerge() {
    if (!fs.existsSync(MASTER_PATH)) return;
    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const stamp      = timestampForBackupFilename();
        const backupPath = path.join(BACKUP_DIR, `${stamp}-master.json`);
        fs.copyFileSync(MASTER_PATH, backupPath);
        console.log(`[siteConfig] backed up master.json → ${path.relative(CONFIG_DIR, backupPath)}`);
    } catch (e) {
        console.error(`[siteConfig] failed to back up master.json before merge: ${e.message}`);
    }
}

function getDefaults() {
    const existing = readJsonSafe(DEFAULTS_PATH, null);
    if (existing) return existing;
    writeJsonSafe(DEFAULTS_PATH, HARD_FALLBACK_DEFAULTS);
    return HARD_FALLBACK_DEFAULTS;
}

function ensureMasterConfig() {
    const defaults          = getDefaults();
    const existingMasterRaw = readJsonSafe(MASTER_PATH, null);
    const merged            = coerceNumericStrings(deepMerge(defaults, existingMasterRaw || {}));

    if (!existingMasterRaw || !deepEqual(existingMasterRaw, merged)) {
        if (existingMasterRaw) backupMasterBeforeMerge();
        if (writeJsonSafe(MASTER_PATH, merged)) {
            console.log(existingMasterRaw
                ? "[siteConfig] master.json was missing fields or had quoted-number values — normalized (backup saved)"
                : "[siteConfig] master.json was missing — created from defaults");
        }
    }

    return merged;
}

function getFullConfig() {
    const defaults = getDefaults();
    const master   = readJsonSafe(MASTER_PATH, {});
    return coerceNumericStrings(deepMerge(defaults, master));
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

function getThemeDefaults() {
    return getDefaults().theme;
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

function getLibraries() {
    const list = readJsonSafe(LIBRARIES_PATH, []);
    if (!Array.isArray(list)) return [];
    return list
        .filter(lib =>
            lib &&
            typeof lib.path === "string" && lib.path.length > 0 &&
            Number.isInteger(lib.depth) && lib.depth >= 1
        )
        .map(lib => ({
            ...lib,
            hidden: lib.hidden === true,
            useDates: lib.useDates === true,
        }));
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
    BACKUP_DIR,
    coerceNumericStrings,
    ensureMasterConfig,
    getFullConfig,
    saveMasterConfig,
    getSiteInfo,
    getTheme,
    getThemeDefaults,
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
