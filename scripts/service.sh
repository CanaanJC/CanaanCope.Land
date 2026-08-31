#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_NAME_FILE="${SCRIPT_DIR}/service-name.txt"
LEGACY_NAME_FILE="${SCRIPT_DIR}/.service-name"
SERVICE_META_FILE="${SCRIPT_DIR}/service-meta.env"

if [[ "${EUID}" -ne 0 ]]; then
    echo "service.sh: this script must be run with sudo (systemctl requires root)." >&2
    echo "            try: sudo ./scripts/service.sh" >&2
    exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
    echo "service.sh: systemctl not found — this script only supports systemd-based systems." >&2
    exit 1
fi

SERVICE_NAME=""

if [[ -f "${SERVICE_NAME_FILE}" ]]; then
    SERVICE_NAME="$(tr -d '[:space:]' < "${SERVICE_NAME_FILE}" || true)"
elif [[ -f "${LEGACY_NAME_FILE}" ]]; then
    SERVICE_NAME="$(tr -d '[:space:]' < "${LEGACY_NAME_FILE}" || true)"
    if [[ -n "${SERVICE_NAME}" ]]; then
        echo "${SERVICE_NAME}" > "${SERVICE_NAME_FILE}"
    fi
fi

if [[ -z "${SERVICE_NAME}" ]]; then
    echo "service.sh: no service name found." >&2
    echo "            expected ${SERVICE_NAME_FILE}" >&2
    echo "            run the installer first: sudo ./scripts/run.sh" >&2
    exit 1
fi

UNIT_NAME="${SERVICE_NAME}.service"
UNIT_FILE="/etc/systemd/system/${UNIT_NAME}"

if [[ ! -f "${UNIT_FILE}" ]]; then
    echo "service.sh: service \"${SERVICE_NAME}\" is registered here but ${UNIT_FILE} does not exist." >&2
    echo "            re-run: sudo ./scripts/run.sh" >&2
    exit 1
fi

UNIT_WORKDIR="$(sed -n 's/^WorkingDirectory=//p' "${UNIT_FILE}" | head -n1)"
UNIT_EXEC="$(sed -n 's/^ExecStart=//p' "${UNIT_FILE}" | head -n1)"
UNIT_USER="$(sed -n 's/^User=//p' "${UNIT_FILE}" | head -n1)"

META_PROJECT_ROOT=""
if [[ -f "${SERVICE_META_FILE}" ]]; then
    META_PROJECT_ROOT="$(sed -n 's/^PROJECT_ROOT=//p' "${SERVICE_META_FILE}" | head -n1)"
fi

do_start() {
    echo "Starting ${SERVICE_NAME}..."
    systemctl reset-failed "${UNIT_NAME}" 2>/dev/null || true
    systemctl start "${UNIT_NAME}"
    systemctl status "${UNIT_NAME}" --no-pager -l || true
}

do_stop() {
    echo "Stopping ${SERVICE_NAME}..."
    systemctl stop "${UNIT_NAME}" 2>/dev/null || true
    if systemctl is-active --quiet "${UNIT_NAME}" 2>/dev/null; then
        echo "Still running, force killing..."
        systemctl kill --signal=SIGKILL "${UNIT_NAME}" 2>/dev/null || true
        sleep 1
    fi
    systemctl reset-failed "${UNIT_NAME}" 2>/dev/null || true
    echo "Stopped."
}

do_restart() {
    echo "Restarting ${SERVICE_NAME}..."
    systemctl reset-failed "${UNIT_NAME}" 2>/dev/null || true
    systemctl restart "${UNIT_NAME}"
    systemctl status "${UNIT_NAME}" --no-pager -l || true
}

do_enable() {
    systemctl enable "${UNIT_NAME}"
    echo "Enabled ${SERVICE_NAME} on boot."
}

do_disable() {
    systemctl disable "${UNIT_NAME}" 2>/dev/null || true
    echo "Disabled ${SERVICE_NAME} from starting on boot."
}

do_server_logs() {
    echo "Tailing SERVER output for ${SERVICE_NAME} (node stdout/stderr only, Ctrl+C to exit)..."
    echo ""
    journalctl -u "${UNIT_NAME}" -t "${SERVICE_NAME}" -o cat -n 200 -f
}

do_service_logs() {
    echo "Tailing SERVICE logs for ${UNIT_NAME} (systemd unit events, Ctrl+C to exit)..."
    echo ""
    journalctl -u "${UNIT_NAME}" _COMM=systemd -n 200 -f
}

do_status() {
    local active_state enabled_state main_pid since
    active_state="$(systemctl is-active "${UNIT_NAME}" 2>/dev/null | head -n1 || echo "unknown")"
    enabled_state="$(systemctl is-enabled "${UNIT_NAME}" 2>/dev/null | head -n1 || echo "not-enabled")"
    main_pid="$(systemctl show -p MainPID --value "${UNIT_NAME}" 2>/dev/null || echo "0")"
    since="$(systemctl show -p ActiveEnterTimestamp --value "${UNIT_NAME}" 2>/dev/null || true)"

    [[ -z "${active_state}" ]] && active_state="unknown"
    [[ -z "${enabled_state}" ]] && enabled_state="not-enabled"

    case "${active_state}" in
        active) echo "Status: RUNNING (pid ${main_pid})" ;;
        *) echo "Status: NOT RUNNING (${active_state})" ;;
    esac

    case "${enabled_state}" in
        enabled|enabled-runtime) echo "Boot:   ENABLED" ;;
        *) echo "Boot:   DISABLED (${enabled_state})" ;;
    esac

    [[ -n "${since}" && "${active_state}" == "active" ]] && echo "Since:  ${since}"
    echo "Unit:   ${UNIT_FILE}"
}

echo "Service: ${SERVICE_NAME}"
echo "Unit:    ${UNIT_NAME}"
echo "Project: ${UNIT_WORKDIR:-${PROJ_PATH}}"
echo "Command: ${UNIT_EXEC:-unknown}"
echo "User:    ${UNIT_USER:-root}"

if [[ -n "${UNIT_WORKDIR}" && ! -d "${UNIT_WORKDIR}" ]]; then
    echo ""
    echo "WARNING: WorkingDirectory ${UNIT_WORKDIR} does not exist — the service cannot start."
    echo "         re-run: sudo ./scripts/run.sh"
fi

if [[ -n "${META_PROJECT_ROOT}" && "${META_PROJECT_ROOT}" != "${PROJ_PATH}" ]]; then
    echo ""
    echo "WARNING: this unit was registered for ${META_PROJECT_ROOT} but you are running from ${PROJ_PATH}."
fi

echo
echo "1) Stop"
echo "2) Disable"
echo "3) Start"
echo "4) Enable"
echo "5) View live server logs"
echo "6) View live service logs"
echo "7) Status"
echo "8) Restart"
read -rp "Choose an option [1-8]: " choice

case "${choice}" in
    1) do_stop ;;
    2) do_disable ;;
    3) do_start ;;
    4) do_enable ;;
    5) do_server_logs ;;
    6) do_service_logs ;;
    7) do_status ;;
    8) do_restart ;;
    *) echo "Invalid option" ;;
esac
