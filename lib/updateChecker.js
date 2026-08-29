const fs = require("fs");
const path = require("path");

const CONFIG_DIR    = path.join(__dirname, "..", "config");
const VERSION_FILE  = path.join(CONFIG_DIR, "version.txt");

// Same public repo update.sh points at.
const GITHUB_OWNER = "CanaanJC";
const GITHUB_REPO  = "CanaanCope.Land";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function logU(...args) {
    console.log("[update-checker]", ...args);
}

// In-memory cache — this is the whole point: the frontend never triggers a
// real GitHub API call on page load/refresh, it just reads whatever this
// module last found. Only a boot check, the hourly interval, or an explicit
// POST /api/update-check (the admin panel's refresh button) ever actually
// hits the network.
let state = {
    localVersion: null,
    remoteVersion: null,
    updateAvailable: false,
    lastChecked: null,
    error: null,
    checking: false,
};

function getLocalVersion() {
    try {
        const text = fs.readFileSync(VERSION_FILE, "utf-8").trim();
        return text || "0.0.0";
    } catch {
        return "0.0.0";
    }
}

// Compares two dot-separated version strings numerically, segment by
// segment — mirrors `sort -V`'s behavior for the version formats this
// project uses (e.g. 26.8.1 < 26.8.2 < 26.11.8). Returns -1, 0, or 1.
function compareVersions(a, b) {
    const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
}

// Actually hits the GitHub API. Always resolves (never rejects) — on
// failure the cached state just gets an `error` field, localVersion is
// still refreshed from disk, and everything else about the previous
// successful check (if any) is left untouched so a transient network blip
// doesn't wipe out a previously-known "update available" flag.
async function performCheck() {
    state.checking = true;
    const localVersion = getLocalVersion();

    try {
        const res = await fetch(GITHUB_API_URL, {
            headers: { "User-Agent": "canaancope-update-checker" },
        });
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

        const json = await res.json();
        const tag  = json && json.tag_name;
        if (!tag) throw new Error("No tag_name in latest release response");

        const remoteVersion   = tag.replace(/^v/, "");
        const updateAvailable = compareVersions(localVersion, remoteVersion) < 0;

        state = {
            localVersion,
            remoteVersion,
            updateAvailable,
            lastChecked: new Date().toISOString(),
            error: null,
            checking: false,
        };

        logU(`checked — local ${localVersion}, remote ${remoteVersion}${updateAvailable ? " (update available)" : ""}`);
    } catch (e) {
        state = {
            ...state,
            localVersion,
            lastChecked: new Date().toISOString(),
            error: e.message,
            checking: false,
        };
        logU(`check failed: ${e.message}`);
    }

    return state;
}

function getStatus() {
    return { ...state };
}

// Called once at boot (immediate check), then re-checks every hour on its
// own — the admin panel just polls the cached state via GET, never
// triggering a network call by itself.
function startUpdateChecker() {
    performCheck().catch(e => logU(`error: ${e.message}`));
    return setInterval(() => {
        performCheck().catch(e => logU(`error: ${e.message}`));
    }, CHECK_INTERVAL_MS).unref();
}

module.exports = {
    startUpdateChecker,
    performCheck,
    getStatus,
};
