const fs = require("fs");
const path = require("path");
const { getBackupConfig, getSiteInfo, getWebhooks } = require("./siteConfig");
const { randomUUID } = require("crypto");

const PROJECT_ROOT   = path.join(__dirname, "..");
const CHECK_INTERVAL_MS = 30 * 1000; // check schedule every 30s

// Entries at the project root to copy verbatim. Everything needed to run the
// server exactly as it exists right now — a true freeze, dependencies
// included, so the archive never breaks from npm registry drift years later.
// ADMIN/ included so archived instances can also spin up their admin panel
// (older backups made before Admin existed simply won't have it — handled
// gracefully at archive-start time by node.js itself skipping it).
//
// Exported so other modules (e.g. lib/adminRoutes.js's server-size badge)
// can mirror exactly what actually gets backed up, without duplicating or
// drifting out of sync with this list.
const COPY_ENTRIES = ["node.js", "lib", "config", "public", "ADMIN", "extensions", "package.json", "package-lock.json", "node_modules", "run.sh"];

// Any path segment starting with ".tmp" is skipped entirely during backup
// (e.g. ADMIN/.tmp-downloads — scratch space for archive-download zips,
// never worth freezing into a backup).
const TMP_DIR_RE = /^\.tmp/i;

function pathHasTmpSegment(p) {
    return p.split(path.sep).some(seg => TMP_DIR_RE.test(seg));
}

function logB(...args) {
    console.log("[backup]", ...args);
}

function sanitizeName(name) {
    return String(name || "site").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function pad(n) {
    return String(n).padStart(2, "0");
}

function timestampForFolder(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${pad(weekNo)}`;
}

function currentPeriodKey(interval, date) {
    switch (interval) {
        case "daily":   return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        case "weekly":  return isoWeek(date);
        case "yearly":  return `${date.getFullYear()}`;
        case "monthly":
        default:        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    }
}

function isPeriodStartDay(interval, date) {
    switch (interval) {
        case "daily":   return true;
        case "weekly":  return date.getDay() === 1;
        case "yearly":  return date.getMonth() === 0 && date.getDate() === 1;
        case "monthly":
        default:        return date.getDate() === 1;
    }
}

function computeNextBackupTime(cfg, from = new Date()) {
    const [hh, mm] = (cfg.time || "00:00").split(":").map(Number);
    const candidate = new Date(from);
    candidate.setSeconds(0, 0);

    switch (cfg.interval) {
        case "daily": {
            candidate.setHours(hh, mm, 0, 0);
            if (candidate <= from) candidate.setDate(candidate.getDate() + 1);
            break;
        }
        case "weekly": {
            candidate.setHours(hh, mm, 0, 0);
            const day  = candidate.getDay();
            const diff = (1 - day + 7) % 7;
            candidate.setDate(candidate.getDate() + diff);
            if (candidate <= from) candidate.setDate(candidate.getDate() + 7);
            break;
        }
        case "yearly": {
            candidate.setHours(hh, mm, 0, 0);
            candidate.setMonth(0, 1);
            if (candidate <= from) candidate.setFullYear(candidate.getFullYear() + 1);
            break;
        }
        case "monthly":
        default: {
            candidate.setHours(hh, mm, 0, 0);
            candidate.setDate(1);
            if (candidate <= from) {
                candidate.setMonth(candidate.getMonth() + 1);
                candidate.setDate(1);
            }
            break;
        }
    }
    return candidate;
}

function getStatePath(backupRoot) {
    return path.join(backupRoot, ".backup-state.json");
}

function readState(backupRoot) {
    try {
        return JSON.parse(fs.readFileSync(getStatePath(backupRoot), "utf-8"));
    } catch {
        return { lastPeriodKey: null };
    }
}

function writeState(backupRoot, state) {
    try {
        fs.writeFileSync(getStatePath(backupRoot), JSON.stringify(state, null, 4));
    } catch (e) {
        logB(`failed to write state file: ${e.message}`);
    }
}

function getManifestPath(backupRoot) {
    return path.join(backupRoot, "manifest.json");
}

function readManifest(backupRoot) {
    try {
        const data = JSON.parse(fs.readFileSync(getManifestPath(backupRoot), "utf-8"));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function appendManifestEntry(backupRoot, entry) {
    const manifest = readManifest(backupRoot);
    manifest.push(entry);
    try {
        fs.writeFileSync(getManifestPath(backupRoot), JSON.stringify(manifest, null, 4));
    } catch (e) {
        logB(`failed to write manifest.json: ${e.message}`);
    }
}

function getDirSize(targetPath) {
    let total = 0;
    let stat;
    try { stat = fs.statSync(targetPath); } catch { return 0; }

    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;

    for (const entry of fs.readdirSync(targetPath)) {
        if (TMP_DIR_RE.test(entry)) continue; // skip .tmp* dirs/files
        total += getDirSize(path.join(targetPath, entry));
    }
    return total;
}

function fmtBytes(n) {
    if (!n && n !== 0) return "?";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function sendBackupWebhook({ uuid, sizeBytes, timestamp, nextBackupAt, tag }) {
    const { backup: webhookUrl } = getWebhooks();
    if (!webhookUrl) return;

    const { siteAddress } = getSiteInfo();
    const link = `${siteAddress || ""}/archive/${uuid}`;

    const fields = [
        { name: "UUID", value: uuid, inline: false },
        { name: "Size", value: fmtBytes(sizeBytes), inline: true },
        { name: "Date", value: timestamp.toISOString(), inline: true },
        { name: "Link", value: link, inline: false },
    ];

    if (tag) {
        fields.push({ name: "Tag", value: tag, inline: false });
    }

    if (nextBackupAt) {
        fields.push({ name: "Next Backup", value: nextBackupAt.toISOString(), inline: false });
    }

    const payload = {
        embeds: [
            {
                title: "Backup Complete",
                color: 0x57f287,
                fields,
                timestamp: timestamp.toISOString(),
            },
        ],
    };

    try {
        await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    } catch (e) {
        logB(`failed to send backup webhook: ${e.message}`);
    }
}

function copyProjectInto(destDir) {
    const resolvedDest = path.resolve(destDir);

    fs.mkdirSync(destDir, { recursive: true });

    for (const entry of COPY_ENTRIES) {
        const srcPath = path.join(PROJECT_ROOT, entry);
        if (!fs.existsSync(srcPath)) continue;

        const resolvedSrc = path.resolve(srcPath);
        if (resolvedDest.startsWith(resolvedSrc)) {
            logB(`skipping "${entry}" — backup destination is nested inside it (misconfigured backup.path?)`);
            continue;
        }

        const destPath = path.join(destDir, entry);
        fs.cpSync(srcPath, destPath, {
            recursive: true,
            dereference: false,
            // Skip any path whose relative-to-srcPath segments include a
            // ".tmp*" folder (e.g. ADMIN/.tmp-downloads) — scratch space
            // that should never be frozen into a backup.
            filter: (src) => {
                const rel = path.relative(srcPath, src);
                return !pathHasTmpSegment(rel);
            },
        });
    }
}

// `force` — bypass the schedule and run immediately (manual trigger, or the
// update.sh pre-update safety backup). `tag` — optional free-text label
// stored on the manifest entry and included in the Discord webhook, e.g.
// "updating version from 26.8.0 to 26.8.1".
//
// IMPORTANT: on any failure (most commonly EACCES from a misconfigured or
// unwritable backup.path), this THROWS rather than silently swallowing the
// error and returning — callers (the terminal command, the scheduler, and
// especially update.sh, which treats a successful backup as a precondition
// for safely overwriting files) all depend on a rejected/thrown failure to
// know the backup did NOT actually happen. Silently returning here used to
// mean update.sh would print "backup complete" even after a real copy
// failure — this fixes that.
async function performBackup({ force = false, tag = null } = {}) {
    const cfg = getBackupConfig();
    if (!force && !cfg.enabled) return;
    if (!cfg.path) {
        const msg = "backup.path is empty — skipping";
        logB(msg);
        if (force) throw new Error(msg);
        return;
    }

    const { siteName } = getSiteInfo();
    const siteFolder = sanitizeName(siteName);
    const backupRoot = path.join(cfg.path, siteFolder);

    const now = new Date();
    const periodKey = currentPeriodKey(cfg.interval, now);
    const state = readState(backupRoot);

    if (!force) {
        if (state.lastPeriodKey === periodKey) return;
        if (!isPeriodStartDay(cfg.interval, now)) return;

        const [hh, mm] = (cfg.time || "00:00").split(":").map(Number);
        if (now.getHours() !== hh || now.getMinutes() !== mm) return;
    }

    logB(`starting backup for "${siteName}"${force ? " (manual trigger)" : ` (interval: ${cfg.interval})`}${tag ? ` — tag: "${tag}"` : ""}`);

    const uuid       = randomUUID();
    const yearFolder = String(now.getFullYear());
    const tsFolder   = timestampForFolder(now);
    const destDir    = path.join(backupRoot, "archive", yearFolder, tsFolder);

    try {
        copyProjectInto(destDir);
    } catch (e) {
        // Re-throw (don't swallow) — see function-level comment above for why
        // this matters. Still logged here for terminal/scheduler visibility.
        console.error(`[backup] copy failed: ${e.message}`);
        throw e;
    }

    const sizeBytes = getDirSize(destDir);
    const nextBackupAt = computeNextBackupTime(cfg, now);

    appendManifestEntry(backupRoot, {
        uuid,
        timestamp: now.toISOString(),
        folderPath: destDir,
        sizeBytes,
        nodeVersion: process.version,
        nextBackupAt: nextBackupAt.toISOString(),
        tag: tag || null,
    });

    if (!force) {
        writeState(backupRoot, { lastPeriodKey: periodKey });
    }

    logB(`backup complete: ${uuid} (${fmtBytes(sizeBytes)}) → ${destDir}`);
    logB(`next backup scheduled for: ${nextBackupAt.toISOString()}`);

    await sendBackupWebhook({ uuid, sizeBytes, timestamp: now, nextBackupAt, tag });
}

function startBackupScheduler() {
    performBackup().catch(e => console.error(`[backup] error: ${e.message}`));
    return setInterval(() => {
        performBackup().catch(e => console.error(`[backup] error: ${e.message}`));
    }, CHECK_INTERVAL_MS).unref();
}

function startTerminalCommands() {
    if (!process.stdin.isTTY) return;

    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin });

    logB('terminal ready — type "backup" + Enter to trigger a manual backup');

    rl.on("line", (line) => {
        const cmd = line.trim().toLowerCase();
        if (cmd === "backup") {
            logB("manual backup triggered from terminal");
            performBackup({ force: true }).catch(e => console.error(`[backup] error: ${e.message}`));
        } else if (cmd) {
            logB(`unknown command: "${cmd}"`);
        }
    });
}

module.exports = {
    startBackupScheduler,
    startTerminalCommands,
    performBackup,
    computeNextBackupTime,
    COPY_ENTRIES,
};
