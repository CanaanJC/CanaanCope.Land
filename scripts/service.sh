#!/usr/bin/env bash
#
# scripts/service.sh — interactive control menu for the systemd service
# created by scripts/run.sh. Run from anywhere; always operates on the
# project root (one level up from this script). Must be run with sudo
# (systemctl start/stop/restart require root).
#
# Menu:
#   1) Status         — systemctl status
#   2) Start           — systemctl start
#   3) Stop            — systemctl stop
#   4) Restart         — systemctl restart
#   5) Live logs       — journalctl -f for this unit. Plain read-only tail,
#                        Ctrl+C returns to this menu (does NOT stop the
#                        service — only journalctl itself is killed).
#   6) Enable on boot   — systemctl enable
#   7) Disable on boot  — systemctl disable
#   8) Uninstall        — stop, disable, and remove the unit file entirely
#                         (asks for confirmation first — this is destructive
#                         to the *service*, never to the project files).
#   0) Exit
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
SERVICE_NAME_FILE="scripts/.service-name"

# ── Require root/sudo ─────────────────────────────────────────────────────────

if [[ "${EUID}" -ne 0 ]]; then
    echo "service.sh: this script must be run with sudo (systemctl requires root)." >&2
    echo "            try: sudo ./scripts/service.sh" >&2
    exit 1
fi

# ── Resolve the service name ──────────────────────────────────────────────────

if [[ ! -f "${SERVICE_NAME_FILE}" ]]; then
    echo "service.sh: ${SERVICE_NAME_FILE} not found — run ./scripts/run.sh first to set up the service." >&2
    exit 1
fi

SERVICE_NAME="$(tr -d '[:space:]' < "${SERVICE_NAME_FILE}")"

if [[ -z "${SERVICE_NAME}" ]]; then
    echo "service.sh: ${SERVICE_NAME_FILE} is empty — run ./scripts/run.sh again to reconfigure." >&2
    exit 1
fi

UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ ! -f "${UNIT_PATH}" ]]; then
    echo "service.sh: no unit file found at ${UNIT_PATH} for service \"${SERVICE_NAME}\"."
    echo "            run ./scripts/run.sh to (re)install it."
    exit 1
fi

# ── Live logs (menu option 5) ─────────────────────────────────────────────────
#
# Plain read-only tail of this unit's journal, using journalctl's "cat"
# output format — this strips all of journald's own metadata (timestamp,
# hostname, unit/PID prefix) from every line and prints just the raw
# message content, i.e. exactly what the node process itself writes to
# stdout/stderr — the same thing you'd see running `node node.js` directly
# in a terminal, not a service-log-formatted view of it.
# Ctrl+C just interrupts journalctl (SIGINT) and returns control to this
# script's menu loop below — it has no effect whatsoever on the actual
# running service.
live_logs() {
    echo ""
    echo "── Live logs for \"${SERVICE_NAME}\" (Ctrl+C to return to menu) ──"
    echo ""
    journalctl -u "${SERVICE_NAME}" -f -o cat --no-pager || true
    echo ""
    echo "── returned to menu ──"
}


# ── Uninstall (menu option 8) ─────────────────────────────────────────────────

uninstall_service() {
    echo ""
    read -rp "This will stop, disable, and permanently remove the \"${SERVICE_NAME}\" service. Continue? [y/N]: " confirm
    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
        echo "service.sh: uninstall cancelled."
        return
    fi

    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
    rm -f "${UNIT_PATH}"
    systemctl daemon-reload

    echo "service.sh: \"${SERVICE_NAME}\" uninstalled (project files on disk are untouched)."
    echo "service.sh: note — ${SERVICE_NAME_FILE} still remembers this name; run ./scripts/run.sh to reinstall it later."
}

# ── Menu ───────────────────────────────────────────────────────────────────────

print_menu() {
    echo ""
    echo "── ${SERVICE_NAME} — service control ──"
    echo "  1) Status"
    echo "  2) Start"
    echo "  3) Stop"
    echo "  4) Restart"
    echo "  5) Live logs"
    echo "  6) Enable on boot"
    echo "  7) Disable on boot"
    echo "  8) Uninstall service"
    echo "  0) Exit"
}

while true; do
    print_menu
    read -rp "Choose an option [0-8]: " choice

    case "${choice}" in
        1) systemctl status "${SERVICE_NAME}" --no-pager || true ;;
        2) systemctl start "${SERVICE_NAME}" && echo "service.sh: started." ;;
        3) systemctl stop "${SERVICE_NAME}" && echo "service.sh: stopped." ;;
        4) systemctl restart "${SERVICE_NAME}" && echo "service.sh: restarted." ;;
        5) live_logs ;;
        6) systemctl enable "${SERVICE_NAME}" && echo "service.sh: enabled on boot." ;;
        7) systemctl disable "${SERVICE_NAME}" && echo "service.sh: disabled on boot." ;;
        8) uninstall_service ;;
        0) echo "service.sh: bye."; exit 0 ;;
        *) echo "service.sh: invalid option." ;;
    esac
done
