console.log("Archive viewer module loaded");

const parts = window.location.pathname.split("/").filter(Boolean);
const uuid  = parts[1]; // /archive/<uuid>

document.getElementById("archive-uuid").textContent = uuid || "";

const idlePanel        = document.getElementById("archive-idle");
const statusPanel      = document.getElementById("archive-status-panel");
const nextBackupEl     = document.getElementById("archive-next-backup");

const startBtn         = document.getElementById("archive-start-btn");
const killBtn          = document.getElementById("archive-kill-btn");
const statusText       = document.getElementById("archive-status-text");
const logEl            = document.getElementById("archive-log");
const linkWrap         = document.getElementById("archive-link-wrap");
const lanLinkEl        = document.getElementById("archive-lan-link");
const adminLinkWrap    = document.getElementById("archive-admin-link-wrap");
const adminLanLinkEl   = document.getElementById("archive-admin-lan-link");
const countdownEl      = document.getElementById("archive-countdown");

let eventSource    = null;
let heartbeatTimer = null;
let countdownTimer = null;
let expiresAt      = null;
let maxExpiresAt   = null;

function showPanel(name) {
    idlePanel.hidden   = name !== "idle";
    statusPanel.hidden = name !== "status";
}

function appendLog(line) {
    logEl.textContent += line + "\n";
    logEl.scrollTop = logEl.scrollHeight;
}

function setLanLink(lanIp, port) {
    const url = `http://${lanIp}:${port}/`;
    lanLinkEl.href = url;
    lanLinkEl.textContent = url;
    linkWrap.hidden = false;
    killBtn.hidden = false;
    statusText.textContent = "Running";
}

function setAdminLanLink(lanIp, port) {
    const url = `http://${lanIp}:${port}/`;
    adminLanLinkEl.href = url;
    adminLanLinkEl.textContent = url;
    adminLinkWrap.hidden = false;
}

function hideAdminLink() {
    adminLinkWrap.hidden = true;
}

function fmtRemaining(ms) {
    if (ms <= 0) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

function tickCountdown() {
    const candidates = [expiresAt, maxExpiresAt].filter(Boolean);
    if (candidates.length === 0) return;
    const soonest = Math.min(...candidates);
    const isMax = soonest === maxExpiresAt && soonest !== expiresAt;
    const remaining = soonest - Date.now();
    const label = isMax
        ? `Time remaining before forced shutdown (max runtime reached)`
        : `Time remaining before idle shutdown`;
    countdownEl.textContent = `${label}: ${fmtRemaining(remaining)}`;
}

function startCountdown(newExpiresAt, newMaxExpiresAt) {
    if (newExpiresAt)    expiresAt = newExpiresAt;
    if (newMaxExpiresAt) maxExpiresAt = newMaxExpiresAt;
    countdownEl.hidden = false;
    tickCountdown(); // render immediately, don't wait 1s for the first tick
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(tickCountdown, 1000);
}

function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    countdownEl.hidden = true;
    countdownEl.textContent = "";
    expiresAt = null;
    maxExpiresAt = null;
}

function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
        fetch(`/archive/${uuid}/heartbeat`)
            .then(res => res.json())
            .then((info) => {
                if (info.expiresAt) expiresAt = info.expiresAt;
                if (info.maxExpiresAt) maxExpiresAt = info.maxExpiresAt;
            })
            .catch(() => {});
    }, 15000);
}

function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
}

function resetToIdle() {
    stopHeartbeat();
    stopCountdown();
    if (eventSource) { eventSource.close(); eventSource = null; }
    logEl.textContent = "";
    linkWrap.hidden = true;
    hideAdminLink();
    killBtn.hidden = true;
    showPanel("idle");
}

function showNextBackup(nextBackupAt) {
    if (!nextBackupAt) {
        nextBackupEl.hidden = true;
        return;
    }
    const d = new Date(nextBackupAt);
    const formatted = d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    nextBackupEl.textContent = `Next scheduled backup: ${formatted}`;
    nextBackupEl.hidden = false;
}

function connectLogs() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/archive/${uuid}/logs`);

    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.line) appendLog(data.line);

        if (data.status === "running") {
            fetch(`/archive/${uuid}/status`)
                .then(res => res.json())
                .then((info) => {
                    setLanLink(info.lanIp, info.port);
                    startCountdown(info.expiresAt, info.maxExpiresAt);
                    if (info.adminStatus === "running" && info.adminPort) {
                        setAdminLanLink(info.adminLanIp, info.adminPort);
                    }
                })
                .catch((err) => console.error("Archive: failed to fetch status:", err));
            startHeartbeat();
        } else if (data.status === "stopped") {
            resetToIdle();
        } else if (data.status === "error") {
            console.error("Archive: instance failed to start or crashed — see log box for details.");
            stopHeartbeat();
            stopCountdown();
            if (eventSource) eventSource.close();
            statusText.textContent = "Error — see log below";
        }

        if (data.adminStatus === "running") {
            fetch(`/archive/${uuid}/status`)
                .then(res => res.json())
                .then((info) => {
                    if (info.adminPort) setAdminLanLink(info.adminLanIp, info.adminPort);
                })
                .catch(() => {});
        } else if (data.adminStatus === "stopped" || data.adminStatus === "error") {
            hideAdminLink();
        }
    };

    eventSource.onerror = () => {
    };
}

function beginStatusPanel(label) {
    logEl.textContent = "";
    linkWrap.hidden = true;
    hideAdminLink();
    killBtn.hidden = true;
    statusText.textContent = label;
    showPanel("status");
}

function resumeRunning(info) {
    beginStatusPanel(info.status === "running" ? "Running" : "Booting archived server…");
    connectLogs(); // handles all log replay + link/countdown setup once status confirms "running"
    if (info.status === "running") {
        setLanLink(info.lanIp, info.port);
        startHeartbeat();
        startCountdown(info.expiresAt, info.maxExpiresAt);
    }
    if (info.adminStatus === "running" && info.adminPort) {
        setAdminLanLink(info.adminLanIp, info.adminPort);
    }
}

startBtn.addEventListener("click", () => {
    beginStatusPanel("Booting archived server…");

    fetch(`/archive/${uuid}/start`)
        .then(res => res.json())
        .then((info) => {
            if (info.error) {
                console.error("Archive: failed to start instance:", info.error);
                statusText.textContent = `Error: ${info.error}`;
                return;
            }
            connectLogs();
            if (info.status === "running") {
                setLanLink(info.lanIp, info.port);
                startHeartbeat();
            }
            startCountdown(info.expiresAt, info.maxExpiresAt);
            if (info.adminStatus === "running" && info.adminPort) {
                setAdminLanLink(info.adminLanIp, info.adminPort);
            }
        })
        .catch((err) => {
            console.error("Archive: failed to start instance:", err);
            statusText.textContent = `Error: ${err.message}`;
        });
});

killBtn.addEventListener("click", () => {
    fetch(`/archive/${uuid}/kill`).then(resetToIdle);
});

window.addEventListener("beforeunload", () => {
    stopHeartbeat();
});

fetch(`/archive/${uuid}/status`)
    .then(res => res.json())
    .then((info) => {
        showNextBackup(info.nextBackupAt);
        if (info.status && info.status !== "idle") {
            resumeRunning(info);
        } else {
            showPanel("idle");
        }
    })
    .catch((err) => {
        console.error("Archive: failed to fetch initial status:", err);
        showPanel("idle");
    });
