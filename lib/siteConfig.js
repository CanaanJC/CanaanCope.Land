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
            backgroundColor: "",
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

// ── Numeric-field self-healing ────────────────────────────────────────────
//
// Certain config keys are ALWAYS supposed to be numbers (fontSize, depth,
// collapsedWidth, expandedWidth, iconSize) but are extremely easy to
// accidentally write as quoted strings — a form field serializing
// everything as text, a manual edit, an old backup, etc. A quoted "16"
// and a real 16 look identical to a human reading the file, but
// downstream consumers (theme.js's px() helper, the master-override
// strict-equality check in lib/routes.js) treat them completely
// differently, causing exactly this class of "font size silently does
// nothing" bug.
//
// This walks any object/array recursively and coerces any of the keys
// below from a numeric-looking string into a real number. Applied on
// every READ of the full config (so already-broken files serve correct
// values immediately, without needing a resave) and on every WRITE (so
// the bug can never be reintroduced going forward, regardless of which
// endpoint/tool wrote the file).
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

// Atomic write: write to a temp file in the SAME directory, then rename()
// it into place. rename() within the same filesystem is atomic — there is
// no window where the destination file is truncated, half-written, or
// otherwise observable in a corrupt state, regardless of what else reads
// or writes it concurrently (another request, a crash, ensureMasterConfig
// running at boot, etc.). This is what actually fixes the intermittent
// trailing-garbage/NUL-byte corruption — a plain writeFileSync() truncates
// the destination file BEFORE writing the new bytes, leaving a real gap
// during which a concurrent reader (or a process that crashes mid-write)
// can observe a corrupt file.
//
// All numeric-key values are also coerced (see coerceNumericStrings above)
// before serializing, so nothing written through this function can ever
// reintroduce the quoted-number bug.
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

// ISO8601-down-to-seconds, filesystem-safe (colons → dashes), e.g.
// "2026-08-27T14-03-22". Used to name config/backup/<timestamp>-master.json
// snapshots taken right before a merge actually changes master.json on disk.
function timestampForBackupFilename(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Copies the CURRENT on-disk config/master.json into config/backup/ before
// a merge is about to overwrite it. Best-effort — a failure here is logged
// but never blocks the merge/write itself (an unwritable backup folder
// shouldn't be able to brick the server's config handling).
function backupMasterBeforeMerge() {
    if (!fs.existsSync(MASTER_PATH)) return; // nothing to back up yet
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

// Ensures config/master.json exists and has every field defaults.json
// defines, AND that every known-numeric field (fontSize/depth/etc.) is
// actually stored as a real number rather than a quoted string. Any time
// this actually needs to write a changed master.json (new/renamed fields
// merged in, a quoted-number field normalized, or the file didn't exist
// at all), a timestamped snapshot of whatever was on disk beforehand is
// saved to config/backup/ first (skipped only when there was nothing on
// disk yet to snapshot).
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
    // Coerced on every read too — serves correct values immediately even
    // on a request that lands between boots, before ensureMasterConfig's
    // next normalization pass would otherwise catch it.
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

// The theme section of defaults.json, exposed so the theme-resolution
// logic in lib/routes.js can tell "this section's field is still whatever
// defaults.json shipped" apart from "the user actually customized this
// field" — only the latter is allowed to win over theme.master.
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
