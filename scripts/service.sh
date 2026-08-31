#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"
CMD="node node.js"

if [[ "${EUID}" -ne 0 ]]; then
    echo "service.sh: this script must be run with sudo (systemctl requires root)." >&2
    echo "            try: sudo ./scripts/service.sh" >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "service.sh: node is required (used to read siteName from config/master.json)." >&2
    exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
    echo "service.sh: systemctl not found — this script only supports systemd-based systems." >&2
    exit 1
fi

derive_name() {
    local master_json="${PROJ_PATH}/config/master.json"
    local package_json="${PROJ_PATH}/package.json"
    local name=""

    if [[ -f "${master_json}" ]]; then
        name="$(node -e "
            try {
                const c = JSON.parse(require('fs').readFileSync('${master_json}', 'utf-8'));
                if (c && typeof c.siteName === 'string' && c.siteName.trim()) {
                    process.stdout.write(c.siteName.trim());
                }
            } catch {}
        " 2>/dev/null || true)"
    fi

    if [[ -z "${name}" && -f "${package_json}" ]]; then
        name="$(node -e "
            try {
                const p = JSON.parse(require('fs').readFileSync('${package_json}', 'utf-8'));
                if (p && typeof p.name === 'string' && p.name.trim()) {
                    process.stdout.write(p.name.trim());
                }
            } catch {}
        " 2>/dev/null || true)"
    fi

    if [[ -z "${name}" ]]; then
        name="$(basename "${PROJ_PATH}")"
    fi

    if [[ -z "${name}" ]]; then
        name="node-project"
    fi

    echo "${name}"
}

NAME="$(derive_name)"
SLUG="$(echo "${NAME}" | tr '[:upper:]' '[:lower:]' | tr -c '[:alnum:]' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')"
[[ -z "${SLUG}" ]] && SLUG="node-project"
SERVICE_NAME="${SLUG}"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

RUN_AS_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "$USER")}"

resolve_cmd() {
    local first_word rest resolved
    first_word="$(echo "${CMD}" | awk '{print $1}')"
    rest="$(echo "${CMD}" | cut -d' ' -f2-)"
    if [[ "${rest}" == "${first_word}" ]]; then rest=""; fi

    case "${first_word}" in
        /*)
            resolved="${first_word}"
            ;;
        ./*|../*)
            resolved="$(cd "${PROJ_PATH}" && realpath -m "${first_word}")"
            ;;
        *)
            if command -v "${first_word}" >/dev/null 2>&1; then
                resolved="$(command -v "${first_word}")"
            else
                resolved="$(cd "${PROJ_PATH}" && realpath -m "./${first_word}")"
            fi
            ;;
    esac

    if [[ -n "${rest}" ]]; then
        echo "${resolved} ${rest}"
    else
        echo "${resolved}"
    fi
}

generate_unit() {
    local exec_cmd
    exec_cmd="$(resolve_cmd)"

    tee "${UNIT_FILE}" > /dev/null <<EOF
[Unit]
Description=${NAME} service
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJ_PATH}
ExecStart=${exec_cmd}
Restart=on-failure
RestartSec=3
KillMode=control-group
KillSignal=SIGTERM
TimeoutStopSec=5
SendSIGKILL=yes
User=${RUN_AS_USER}

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
}

do_start() {
    generate_unit
    echo "Starting ${SERVICE_NAME}..."
    systemctl start "${SERVICE_NAME}"
    systemctl status "${SERVICE_NAME}" --no-pager -l || true
}

do_stop() {
    echo "Stopping ${SERVICE_NAME}..."
    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
        echo "Still running, force killing..."
        systemctl kill --signal=SIGKILL "${SERVICE_NAME}"
    fi
    pkill -9 -f "$(basename "${CMD}")" 2>/dev/null || true
    echo "Stopped."
}

do_enable() {
    generate_unit
    systemctl enable "${SERVICE_NAME}"
    echo "Enabled ${SERVICE_NAME} on boot."
}

do_disable() {
    systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    echo "Disabled ${SERVICE_NAME} from starting on boot."
}

do_logs() {
    echo "Tailing logs for ${SERVICE_NAME} (Ctrl+C to exit)..."
    journalctl -u "${SERVICE_NAME}" -f -n 100
}

do_status() {
    local active_state enabled_state
    active_state="$(systemctl is-active "${SERVICE_NAME}" 2>/dev/null || echo "unknown")"
    enabled_state="$(systemctl is-enabled "${SERVICE_NAME}" 2>/dev/null || echo "not enabled")"

    case "${active_state}" in
        active) echo "Status: RUNNING" ;;
        *) echo "Status: NOT RUNNING (${active_state})" ;;
    esac

    case "${enabled_state}" in
        enabled) echo "Boot:   ENABLED" ;;
        *) echo "Boot:   DISABLED (${enabled_state})" ;;
    esac
}

echo "Service: ${NAME}"
echo "Project: ${PROJ_PATH}"
echo "Command: ${CMD}"
echo
echo "1) Stop"
echo "2) Disable"
echo "3) Start"
echo "4) Enable"
echo "5) View live logs"
echo "6) Status"
read -rp "Choose an option [1-6]: " choice

case "${choice}" in
    1) do_stop ;;
    2) do_disable ;;
    3) do_start ;;
    4) do_enable ;;
    5) do_logs ;;
    6) do_status ;;
    *) echo "Invalid option" ;;
esac
