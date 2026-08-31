#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"
STATE_DIR="${PROJECT_ROOT}/scripts"
SERVICE_NAME_FILE="${STATE_DIR}/service-name.txt"
SERVICE_META_FILE="${STATE_DIR}/service-meta.env"

if [[ "${EUID}" -ne 0 ]]; then
    echo "run.sh: this script must be run with sudo (it needs to write to /etc/systemd/system/)." >&2
    echo "        try: sudo ./scripts/run.sh" >&2
    exit 1
fi

INVOKING_USER="${SUDO_USER:-root}"

if [[ "${INVOKING_USER}" == "root" ]]; then
    echo "run.sh: warning — no SUDO_USER detected (are you logged in directly as root?)."
    echo "        the service and node_modules/ will be owned by root, which is not"
    echo "        recommended but will still work."
fi

echo "run.sh: project root is ${PROJECT_ROOT}"
echo "run.sh: will run as user \"${INVOKING_USER}\""

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

echo ""
echo "run.sh: running npm install in ${PROJECT_ROOT}..."
echo "run.sh: (safe to run even if node_modules/ already exists — npm reconciles it)"

if [[ "${INVOKING_USER}" == "root" ]]; then
    ( cd "${PROJECT_ROOT}" && npm install )
else
    sudo -u "${INVOKING_USER}" bash -c "cd '${PROJECT_ROOT}' && npm install"
fi

echo "run.sh: npm install complete."

PREVIOUS_SERVICE_NAME=""
if [[ -f "${SERVICE_NAME_FILE}" ]]; then
    PREVIOUS_SERVICE_NAME="$(tr -d '[:space:]' < "${SERVICE_NAME_FILE}" || true)"
elif [[ -f "${STATE_DIR}/.service-name" ]]; then
    PREVIOUS_SERVICE_NAME="$(tr -d '[:space:]' < "${STATE_DIR}/.service-name" || true)"
fi

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

if [[ -n "${PREVIOUS_SERVICE_NAME}" && "${PREVIOUS_SERVICE_NAME}" != "${SERVICE_NAME}" ]]; then
    OLD_UNIT="/etc/systemd/system/${PREVIOUS_SERVICE_NAME}.service"
    if [[ -f "${OLD_UNIT}" ]]; then
        echo ""
        echo "run.sh: this project was previously registered as \"${PREVIOUS_SERVICE_NAME}\"."
        read -rp "Stop, disable, and remove the old \"${PREVIOUS_SERVICE_NAME}\" service? [y/N]: " confirm_cleanup
        if [[ "${confirm_cleanup}" =~ ^[Yy]$ ]]; then
            systemctl stop "${PREVIOUS_SERVICE_NAME}" 2>/dev/null || true
            systemctl disable "${PREVIOUS_SERVICE_NAME}" 2>/dev/null || true
            systemctl reset-failed "${PREVIOUS_SERVICE_NAME}" 2>/dev/null || true
            rm -f "${OLD_UNIT}"
            systemctl daemon-reload
            echo "run.sh: removed ${OLD_UNIT}"
        else
            echo "run.sh: leaving the old service in place."
        fi
    fi
fi

NODE_BIN="$(command -v node)"
EXEC_START="${NODE_BIN} ${PROJECT_ROOT}/node.js"

mkdir -p "${STATE_DIR}"
echo "${SERVICE_NAME}" > "${SERVICE_NAME_FILE}"
rm -f "${STATE_DIR}/.service-name"

cat > "${SERVICE_META_FILE}" <<EOF
SERVICE_NAME=${SERVICE_NAME}
UNIT_PATH=${UNIT_PATH}
PROJECT_ROOT=${PROJECT_ROOT}
RUN_AS_USER=${INVOKING_USER}
EXEC_START=${EXEC_START}
EOF

if [[ "${INVOKING_USER}" != "root" ]]; then
    chown "${INVOKING_USER}:${INVOKING_USER}" "${SERVICE_NAME_FILE}" "${SERVICE_META_FILE}" 2>/dev/null || true
fi

echo "run.sh: saved service name to ${SERVICE_NAME_FILE}"
echo "run.sh: saved service metadata to ${SERVICE_META_FILE}"

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
ExecStart=${EXEC_START}
Restart=on-failure
RestartSec=5
KillMode=control-group
KillSignal=SIGTERM
TimeoutStopSec=5
SendSIGKILL=yes
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
EOF

echo "run.sh: unit file written."

echo ""
echo "run.sh: reloading systemd, enabling, and starting \"${SERVICE_NAME}\"..."

systemctl daemon-reload
systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo ""
echo "run.sh: done. Current status:"
echo ""
systemctl status "${SERVICE_NAME}" --no-pager || true

echo ""
echo "run.sh: use ./scripts/service.sh to control this service going forward."
