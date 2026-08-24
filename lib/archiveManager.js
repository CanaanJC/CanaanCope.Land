const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const net = require("net");
const { getBackupConfig, getSiteInfo, getArchiveConfig } = require("./siteConfig");

const instances = new Map(); // uuid -> instance record

function logA(...args) {
    console.log("[archive]", ...args);
}

function getMaxConcurrent() {
    const cfg = getArchiveConfig();
    return cfg.maxConcurrentInstances || 3;
}

function sanitizeName(name) {
    return String(name || "site").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getManifestPath() {
    const cfg = getBackupConfig();
    const { siteName } = getSiteInfo();
    return path.join(cfg.path, sanitizeName(siteName), "manifest.json");
}

function findManifestEntry(uuid) {
    try {
        const manifest = JSON.parse(fs.readFileSync(getManifestPath(), "utf-8"));
        return Array.isArray(manifest) ? manifest.find(e => e.uuid === uuid) || null : null;
    } catch {
        return null;
    }
}

// Every backup entry ever recorded, newest first. Used by the Admin panel's
// "archive" element to list every past backup as a link — read-only, never
// starts/touches any instance.
function getAllManifestEntries() {
    try {
        const manifest = JSON.parse(fs.readFileSync(getManifestPath(), "utf-8"));
        if (!Array.isArray(manifest)) return [];
        return [...manifest].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch {
        return [];
    }
}

function hasAdminSupport(uuid) {
    const entry = findManifestEntry(uuid);
    if (!entry) return false;
    return fs.existsSync(path.join(entry.folderPath, "lib", "adminServer.js")) &&
           fs.existsSync(path.join(entry.folderPath, "ADMIN"));
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on("error", reject);
    });
}

async function getTwoFreePorts() {
    const first = await getFreePort();
    let second = await getFreePort();
    if (second === first) second = await getFreePort();
    return [first, second];
}

function getLanIp() {
    const cfg = getBackupConfig();
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return cfg.lanIp || null;
}

function getInstance(uuid) {
    return instances.get(uuid) || null;
}

function statusOf(uuid) {
    const instance = instances.get(uuid);
    if (!instance) return null;
    return {
        status: instance.status,
        port: instance.port,
        lanIp: instance.lanIp,
        logs: instance.logs,
        expiresAt: instance.expiresAt,
        maxExpiresAt: instance.maxExpiresAt,
        adminStatus: instance.adminStatus,
        adminPort: instance.adminPort,
        adminLanIp: instance.adminLanIp,
    };
}

function addLog(instance, line) {
    instance.logs.push(line);
    if (instance.logs.length > 500) instance.logs.shift();
    for (const listener of instance.listeners) {
        try { listener(line); } catch {}
    }
}

function armIdleTimer(instance) {
    const cfg = getArchiveConfig();
    const minutes = cfg.idleTimeoutMinutes || 10;

    if (instance.idleTimer) clearTimeout(instance.idleTimer);
    instance.expiresAt = Date.now() + minutes * 60 * 1000;
    instance.idleTimer = setTimeout(() => {
        logA(`instance ${instance.uuid} idle timeout reached — killing`);
        killInstance(instance.uuid);
    }, minutes * 60 * 1000).unref();
}

function resetIdleTimer(uuid) {
    const instance = instances.get(uuid);
    if (instance) armIdleTimer(instance);
}

function armMaxRuntimeTimer(instance) {
    const cfg = getArchiveConfig();
    const minutes = cfg.maxRuntimeMinutes || 60;

    instance.maxExpiresAt = Date.now() + minutes * 60 * 1000;
    instance.maxRuntimeTimer = setTimeout(() => {
        logA(`instance ${instance.uuid} reached absolute max runtime (${minutes}m) — killing regardless of activity`);
        killInstance(instance.uuid);
    }, minutes * 60 * 1000).unref();
}

async function startInstance(uuid) {
    const existing = instances.get(uuid);
    if (existing) return existing;

    const entry = findManifestEntry(uuid);
    if (!entry) throw new Error("No backup found for this UUID");

    const entryPoint = path.join(entry.folderPath, "node.js");
    if (!fs.existsSync(entryPoint)) throw new Error("Archived node.js not found in backup folder");

    if (instances.size >= getMaxConcurrent()) {
        throw new Error(`Maximum concurrent archive instances (${getMaxConcurrent()}) already running`);
    }

    const willHaveAdmin = hasAdminSupport(uuid);

    const instance = {
        uuid,
        status: "starting",
        port: null,
        lanIp: null,
        logs: [],
        listeners: new Set(),
        startedAt: Date.now(),
        idleTimer: null,
        expiresAt: null,
        maxRuntimeTimer: null,
        maxExpiresAt: null,
        proc: null,
        adminStatus: willHaveAdmin ? "starting" : null,
        adminPort: null,
        adminLanIp: null,
    };
    instances.set(uuid, instance);

    let port, adminPort, lanIp;
    try {
        if (willHaveAdmin) {
            [port, adminPort] = await getTwoFreePorts();
        } else {
            port = await getFreePort();
        }
        lanIp = getLanIp();
    } catch (e) {
        instances.delete(uuid);
        throw e;
    }

    instance.port  = port;
    instance.lanIp = lanIp;
    if (willHaveAdmin) {
        instance.adminPort  = adminPort;
        instance.adminLanIp = lanIp;
    }

    logA(`starting instance ${uuid} on port ${port}${willHaveAdmin ? ` (admin on ${adminPort})` : ""}`);

    addLog(instance, `Starting archived instance ${uuid}...`);
    addLog(instance, `Folder: ${entry.folderPath}`);
    addLog(instance, `Port: ${port} (passed as an environment variable — no files in the backup are modified)`);
    if (willHaveAdmin) {
        addLog(instance, `Admin port: ${adminPort} (also passed as an environment variable — same process)`);
    } else {
        addLog(instance, `No admin panel found in this backup — this archive predates the Admin feature.`);
    }

    const proc = spawn(process.execPath, [entryPoint], {
        cwd: entry.folderPath,
        env: {
            ...process.env,
            PORT: String(port),
            HOST: "0.0.0.0",
            ADMIN_PORT: willHaveAdmin ? String(adminPort) : undefined,
            ADMIN_HOST: willHaveAdmin ? "0.0.0.0" : undefined,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    instance.proc = proc;

    logA(`spawned instance ${uuid} (pid ${proc.pid})`);

    proc.stdout.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
            addLog(instance, line);

            if (/^server running at/i.test(line)) {
                instance.status = "running";
                addLog(instance, `__STATUS__running`);
                logA(`instance ${uuid} is now running`);
            }

            if (/^admin server running at/i.test(line)) {
                instance.adminStatus = "running";
                addLog(instance, `__ADMIN_STATUS__running`);
                logA(`admin for instance ${uuid} is now running`);
            }
        }
    });

    proc.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n").filter(Boolean)) {
            addLog(instance, `[stderr] ${line}`);
        }
    });

    proc.on("exit", (code) => {
        addLog(instance, `Process exited (code ${code})`);
        instance.status = "stopped";
        addLog(instance, `__STATUS__stopped`);
        if (willHaveAdmin) {
            instance.adminStatus = "stopped";
            addLog(instance, `__ADMIN_STATUS__stopped`);
        }
        if (instance.idleTimer) clearTimeout(instance.idleTimer);
        if (instance.maxRuntimeTimer) clearTimeout(instance.maxRuntimeTimer);
        if (instances.get(uuid) === instance) instances.delete(uuid);
    });

    proc.on("error", (err) => {
        addLog(instance, `Failed to start: ${err.message}`);
        instance.status = "error";
        addLog(instance, `__STATUS__error`);
        if (instance.maxRuntimeTimer) clearTimeout(instance.maxRuntimeTimer);
        if (instances.get(uuid) === instance) instances.delete(uuid);
    });

    armIdleTimer(instance);
    armMaxRuntimeTimer(instance);
    return instance;
}

function killInstance(uuid) {
    const instance = instances.get(uuid);
    if (!instance) return false;

    logA(`killing instance ${uuid}`);
    if (instance.idleTimer) clearTimeout(instance.idleTimer);
    if (instance.maxRuntimeTimer) clearTimeout(instance.maxRuntimeTimer);
    try { instance.proc.kill("SIGTERM"); } catch {}

    setTimeout(() => {
        if (instances.get(uuid) === instance) {
            try { instance.proc.kill("SIGKILL"); } catch {}
            instances.delete(uuid);
        }
    }, 5000).unref();

    return true;
}

function subscribe(uuid, listener) {
    const instance = instances.get(uuid);
    if (!instance) return () => {};
    instance.listeners.add(listener);
    return () => instance.listeners.delete(listener);
}

module.exports = {
    findManifestEntry,
    getAllManifestEntries,
    hasAdminSupport,
    getInstance,
    statusOf,
    startInstance,
    killInstance,
    resetIdleTimer,
    subscribe,
};
