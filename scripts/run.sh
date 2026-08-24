#!/usr/bin/env bash
#
# scripts/run.sh — first-time setup + systemd service installer.
# Run from anywhere; always operates on the project root (one level up from
# this script). Must be run with sudo (writes to /etc/systemd/system/).
#
# What it does, in order:
#   1. Rejects immediately if not run with root privileges (via sudo).
#   2. Checks for required dependencies (node, npm, jq, curl, tar, git) and
#      offers to `apt-get install` any that are missing.
#   3. Generates a minimal package.json if one doesn't already exist (this
#      repo ships package-lock.json but not package.json — see note below).
#      No-op if package.json is already present, so this is always safe to
#      re-run on an existing install.
#   4. Runs `npm install` in the project root — as the ORIGINAL invoking user
#      (via $SUDO_USER), not root, so node_modules/ isn't root-owned and
#      unusable/hard-to-manage afterward for that user. Safe to re-run even
#      if node_modules/ already exists — npm install is idempotent and will
#      simply reconcile it against package.json/package-lock.json.
#   5. Prompts for a service name (e.g. "canaancope").
#   6. Saves that name to scripts/.service-name so scripts/service.sh can
#      find it later without re-asking.
#   7. Generates a systemd unit file at /etc/systemd/system/<name>.service
#      that runs `node node.js` from the project root, as the invoking user
#      (not root), restarting on failure, logging to the systemd journal.
#   8. daemon-reload, enable, start — then prints `systemctl status` so you
#      can see immediately that it's running.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"
SERVICE_NAME_FILE="scripts/.service-name"

# ── Require root/sudo ─────────────────────────────────────────────────────────

if [[ "${EUID}" -ne 0 ]]; then
    echo "run.sh: this script must be run with sudo (it needs to write to /etc/systemd/system/)." >&2
    echo "        try: sudo ./scripts/run.sh" >&2
    exit 1
fi

# Figure out who actually invoked sudo, so we don't run npm install / the
# service itself as root. Falls back to "root" only if run.sh is somehow
# executed as a true root login shell rather than via sudo (SUDO_USER unset).
INVOKING_USER="${SUDO_USER:-root}"

if [[ "${INVOKING_USER}" == "root" ]]; then
    echo "run.sh: warning — no SUDO_USER detected (are you logged in directly as root?)."
    echo "        the service and node_modules/ will be owned by root, which is not"
    echo "        recommended but will still work."
fi

echo "run.sh: project root is ${PROJECT_ROOT}"
echo "run.sh: will run as user \"${INVOKING_USER}\""

# ── Dependency checks ─────────────────────────────────────────────────────────

echo ""
echo "run.sh: checking dependencies..."

REQUIRED_CMDS=(node npm jq curl tar git)
MISSING_CMDS=()

for cmd in "${REQUIRED_CMDS[@]}"; do
    if command -v "${cmd}" >/dev/null 2>&1; then
        echo "  [ok] ${cmd}"
    else
        echo "  [missing] ${cmd}"
        MISSING_CMDS+=("${cmd}")
    fi
done

if [[ ${#MISSING_CMDS[@]} -gt 0 ]]; then
    echo ""
    echo "The following required commands are missing: ${MISSING_CMDS[*]}"

    if ! command -v apt-get >/dev/null 2>&1; then
        echo "run.sh: apt-get not found on this system — install the above manually and re-run." >&2
        exit 1
    fi

    read -rp "Install them now via apt-get? [y/N]: " confirm_install
    if [[ ! "${confirm_install}" =~ ^[Yy]$ ]]; then
        echo "run.sh: cannot continue without these dependencies. Aborting."
        exit 1
    fi

    apt-get update
    apt-get install -y "${MISSING_CMDS[@]}"

    for cmd in "${MISSING_CMDS[@]}"; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            echo "run.sh: \"${cmd}\" still not found after installation attempt — aborting." >&2
            exit 1
        fi
    done

    echo "run.sh: all dependencies now installed."
else
    echo "run.sh: all dependencies already present."
fi

# ── Generate package.json if missing ──────────────────────────────────────────
#
# This repo intentionally ships package-lock.json (which pins a name and an
# empty dependency set) but not package.json itself. On a fresh checkout
# there's nothing for `npm install` to read at all, which isn't an error —
# it just means this is a first-time setup. If package.json already exists
# (e.g. re-running run.sh on an existing install, or a future release adds
# real dependencies and ships its own package.json), this step is a
# complete no-op.
echo ""

if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
    echo "run.sh: package.json already exists — leaving it untouched."
else
    echo "run.sh: package.json not found — generating a minimal one..."

    PACKAGE_NAME="canaancope.land"
    if [[ -f "${PROJECT_ROOT}/package-lock.json" ]]; then
        LOCK_NAME="$(jq -r '.name // empty' "${PROJECT_ROOT}/package-lock.json" 2>/dev/null || true)"
        [[ -n "${LOCK_NAME}" ]] && PACKAGE_NAME="${LOCK_NAME}"
    fi

    cat > "${PROJECT_ROOT}/package.json" <<EOF
{
    "name": "${PACKAGE_NAME}",
    "version": "1.0.0",
    "private": true,
    "main": "node.js",
    "scripts": {
        "start": "node node.js"
    }
}
EOF

    if [[ "${INVOKING_USER}" != "root" ]]; then
        chown "${INVOKING_USER}:${INVOKING_USER}" "${PROJECT_ROOT}/package.json" 2>/dev/null || true
    fi

    echo "run.sh: generated package.json (name: \"${PACKAGE_NAME}\")."
fi

# ── npm install (as the invoking user, not root) ─────────────────────────────

echo ""
echo "run.sh: running npm install in ${PROJECT_ROOT}..."
echo "run.sh: (safe to run even if node_modules/ already exists — npm reconciles it)"

if [[ "${INVOKING_USER}" == "root" ]]; then
    ( cd "${PROJECT_ROOT}" && npm install )
else
    sudo -u "${INVOKING_USER}" bash -c "cd '${PROJECT_ROOT}' && npm install"
fi

echo "run.sh: npm install complete."

# ── Prompt for service name ───────────────────────────────────────────────────

echo ""
read -rp "Enter a name for this service (e.g. \"canaancope\"): " SERVICE_NAME

if [[ -z "${SERVICE_NAME}" ]]; then
    echo "run.sh: service name cannot be empty — aborting." >&2
    exit 1
fi

if [[ ! "${SERVICE_NAME}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "run.sh: service name may only contain letters, numbers, hyphens, and underscores — aborting." >&2
    exit 1
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ -f "${UNIT_PATH}" ]]; then
    echo ""
    echo "run.sh: a service named \"${SERVICE_NAME}\" already exists at ${UNIT_PATH}."
    read -rp "Overwrite it? [y/N]: " confirm_overwrite
    if [[ ! "${confirm_overwrite}" =~ ^[Yy]$ ]]; then
        echo "run.sh: aborting — no changes made."
        exit 1
    fi
fi

mkdir -p "$(dirname "${SERVICE_NAME_FILE}")"
echo "${SERVICE_NAME}" > "${SERVICE_NAME_FILE}"
echo "run.sh: saved service name to ${SERVICE_NAME_FILE}"

# ── Generate the systemd unit file ───────────────────────────────────────────

NODE_BIN="$(command -v node)"

echo ""
echo "run.sh: writing ${UNIT_PATH}..."

cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=${SERVICE_NAME} (canaancope.dev server)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${INVOKING_USER}
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${NODE_BIN} ${PROJECT_ROOT}/node.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

echo "run.sh: unit file written."

# ── Enable + start ────────────────────────────────────────────────────────────

echo ""
echo "run.sh: reloading systemd, enabling, and starting \"${SERVICE_NAME}\"..."

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl start "${SERVICE_NAME}"

echo ""
echo "run.sh: done. Current status:"
echo ""
systemctl status "${SERVICE_NAME}" --no-pager || true

echo ""
echo "run.sh: use ./scripts/service.sh to control this service going forward."
