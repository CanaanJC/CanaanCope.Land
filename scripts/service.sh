#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ_PATH="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_NAME_FILE="${SCRIPT_DIR}/service-name.txt"
LEGACY_NAME_FILE="${SCRIPT_DIR}/.service-name"
SERVICE_META_FILE="${SCRIPT_DIR}/service-meta.env"
MASTER_JSON="${PROJ_PATH}/config/master.json"
SELF_PID="$$"

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
        rm -f "${LEGACY_NAME_FILE}"
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
TARGET_ROOT="${UNIT_WORKDIR:-${PROJ_PATH}}"

META_SITE_PORT=""
META_ADMIN_PORT=""
META_PROJECT_ROOT=""
if [[ -f "${SERVICE_META_FILE}" ]]; then
    META_PROJECT_ROOT="$(sed -n 's/^PROJECT_ROOT=//p' "${SERVICE_META_FILE}" | head -n1)"
    META_SITE_PORT="$(sed -n 's/^SITE_PORT=//p' "${SERVICE_META_FILE}" | head -n1)"
    META_ADMIN_PORT="$(sed -n 's/^ADMIN_PORT=//p' "${SERVICE_META_FILE}" | head -n1)"
fi

read_port() {
    local key="$1" fallback="$2" value=""
    if [[ -f "${MASTER_JSON}" ]] && command -v jq >/dev/null 2>&1; then
        value="$(jq -r ".hosting.${key} // empty" "${MASTER_JSON}" 2>/dev/null || true)"
    fi
    [[ -z "${value}" || "${value}" == "null" ]] && value="${fallback}"
    echo "${value}"
}

SITE_PORT="$(read_port port "${META_SITE_PORT:-9138}")"
ADMIN_PORT="$(read_port adminPort "${META_ADMIN_PORT:-9832}")"

pid_cwd() {
    readlink -f "/proc/$1/cwd" 2>/dev/null || true
}

pid_exe() {
    readlink -f "/proc/$1/exe" 2>/dev/null || true
}

pid_cmdline() {
    tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true
}

pid_owner_unit() {
    grep -o '[^/]*\.service' "/proc/$1/cgroup" 2>/dev/null | head -n1 || true
}

describe_pid() {
    local pid="$1" exe cmd cwd owner
    exe="$(pid_exe "${pid}")"
    cmd="$(pid_cmdline "${pid}")"
    cwd="$(pid_cwd "${pid}")"
    owner="$(pid_owner_unit "${pid}")"
    [[ -z "${cmd// /}" ]] && cmd="[$(cat "/proc/${pid}/comm" 2>/dev/null || echo unknown)]"
    echo "unit=${owner:-none} cwd=${cwd:-?} exe=${exe:-?} cmd=${cmd}"
}

project_pids() {
    local dir pid cwd exe cmd
    for dir in /proc/[0-9]*; do
        pid="${dir#/proc/}"
        [[ "${pid}" == "${SELF_PID}" ]] && continue
        cwd="$(readlink -f "${dir}/cwd" 2>/dev/null || true)"
        exe="$(readlink -f "${dir}/exe" 2>/dev/null || true)"
        cmd="$(tr '\0' ' ' < "${dir}/cmdline" 2>/dev/null || true)"
        [[ "${exe}" == *node* ]] || continue
        if [[ "${cwd}" == "${TARGET_ROOT}" || "${cmd}" == *"${TARGET_ROOT}/node.js"* ]]; then
            echo "${pid}"
        fi
    done
}

belongs_to_project() {
    local pid="$1" cwd cmd
    cwd="$(pid_cwd "${pid}")"
    cmd="$(pid_cmdline "${pid}")"
    [[ "${cwd}" == "${TARGET_ROOT}" || "${cmd}" == *"${TARGET_ROOT}/node.js"* ]]
}

pid_ports() {
    local pid="$1"
    command -v ss >/dev/null 2>&1 || return 0
    ss -ltnpH 2>/dev/null | grep "pid=${pid}," | awk '{print $4}' | sed 's/.*://' | sort -un
}

port_pids() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        ss -ltnpH 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {print $0}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
    elif command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u
    fi
}

unit_pid() {
    systemctl show -p MainPID --value "${UNIT_NAME}" 2>/dev/null || echo "0"
}

unit_invocation() {
    systemctl show -p InvocationID --value "${UNIT_NAME}" 2>/dev/null || true
}

unit_cgroup_pids() {
    local cg="/sys/fs/cgroup/system.slice/${UNIT_NAME}/cgroup.procs"
    [[ -r "${cg}" ]] && sort -un "${cg}" 2>/dev/null || true
}

is_mine() {
    local target="$1" main_pid p
    main_pid="$(unit_pid)"
    [[ "${target}" == "${main_pid}" ]] && return 0
    while read -r p; do
        [[ -n "${p}" && "${target}" == "${p}" ]] && return 0
    done < <(unit_cgroup_pids)
    return 1
}

kill_pids() {
    local pids=("$@") pid
    for pid in "${pids[@]}"; do
        [[ -z "${pid}" || "${pid}" == "1" ]] && continue
        kill -TERM "${pid}" 2>/dev/null || true
    done
    sleep 2
    for pid in "${pids[@]}"; do
        [[ -z "${pid}" || "${pid}" == "1" ]] && continue
        if kill -0 "${pid}" 2>/dev/null; then
            kill -KILL "${pid}" 2>/dev/null || true
        fi
    done
}

known_ports() {
    local ports=("${SITE_PORT}" "${ADMIN_PORT}") pid pp
    while read -r pid; do
        [[ -z "${pid}" ]] && continue
        mapfile -t pp < <(pid_ports "${pid}")
        ports+=("${pp[@]:-}")
    done < <(unit_cgroup_pids)
    while read -r pid; do
        [[ -z "${pid}" ]] && continue
        mapfile -t pp < <(pid_ports "${pid}")
        ports+=("${pp[@]:-}")
    done < <(project_pids)
    printf '%s\n' "${ports[@]}" | grep -E '^[0-9]+$' | sort -un
}

do_start() {
    echo "Starting ${SERVICE_NAME}..."
    systemctl reset-failed "${UNIT_NAME}" 2>/dev/null || true
    systemctl start "${UNIT_NAME}"
    sleep 3
    systemctl status "${UNIT_NAME}" --no-pager -l || true
    if ! systemctl is-active --quiet "${UNIT_NAME}"; then
        local inv
        inv="$(unit_invocation)"
        echo ""
        echo "Service failed to stay up. Output from THIS run only:"
        echo ""
        if [[ -n "${inv}" ]]; then
            journalctl _SYSTEMD_INVOCATION_ID="${inv}" -o cat --no-pager || true
        else
            journalctl -u "${UNIT_NAME}" -t "${SERVICE_NAME}" -o cat -n 40 --no-pager || true
        fi
        echo ""
        echo "If this is EADDRINUSE, use option 9 to see who owns the port."
    fi
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

    mapfile -t leftovers < <(project_pids | sort -un)
    if [[ ${#leftovers[@]} -gt 0 ]]; then
        echo "Clearing ${#leftovers[@]} leftover process(es) from ${TARGET_ROOT}:"
        for pid in "${leftovers[@]}"; do
            echo "  pid ${pid} — $(describe_pid "${pid}")"
        done
        kill_pids "${leftovers[@]}"
    fi
    echo "Stopped."
}

do_restart() {
    do_stop
    echo ""
    do_start
}

do_enable() {
    systemctl enable "${UNIT_NAME}"
    echo "Enabled ${SERVICE_NAME} on boot."
}

do_disable() {
    systemctl disable "${UNIT_NAME}" 2>/dev/null || true
    echo "Disabled ${SERVICE_NAME} from starting on boot."
    echo "Note: this does not stop a running instance — use option 1 for that."
}

do_server_logs() {
    local inv
    inv="$(unit_invocation)"
    if [[ -n "${inv}" ]]; then
        echo "Tailing SERVER output for ${SERVICE_NAME} (current run only, Ctrl+C to exit)..."
        echo ""
        journalctl _SYSTEMD_INVOCATION_ID="${inv}" -o cat -f
    else
        echo "Service is not running — showing last 200 server lines instead."
        echo ""
        journalctl -u "${UNIT_NAME}" -t "${SERVICE_NAME}" -o cat -n 200 --no-pager
    fi
}

do_server_history() {
    echo "SERVER output for ${SERVICE_NAME}, ALL runs in the journal (Ctrl+C to exit)..."
    echo "Warning: includes output from previous installs on this unit name."
    echo ""
    journalctl -u "${UNIT_NAME}" -t "${SERVICE_NAME}" -n 300 -f
}

do_service_logs() {
    echo "Tailing SERVICE logs for ${UNIT_NAME} (systemd unit events, Ctrl+C to exit)..."
    echo ""
    journalctl -u "${UNIT_NAME}" _COMM=systemd -n 200 -f
}

do_status() {
    local active_state enabled_state main_pid since nrestarts
    active_state="$(systemctl is-active "${UNIT_NAME}" 2>/dev/null | head -n1 || echo "unknown")"
    enabled_state="$(systemctl is-enabled "${UNIT_NAME}" 2>/dev/null | head -n1 || echo "not-enabled")"
    main_pid="$(unit_pid)"
    since="$(systemctl show -p ActiveEnterTimestamp --value "${UNIT_NAME}" 2>/dev/null || true)"
    nrestarts="$(systemctl show -p NRestarts --value "${UNIT_NAME}" 2>/dev/null || echo "0")"

    [[ -z "${active_state}" ]] && active_state="unknown"
    [[ -z "${enabled_state}" ]] && enabled_state="not-enabled"

    case "${active_state}" in
        active) echo "Status:   RUNNING (pid ${main_pid})" ;;
        *) echo "Status:   NOT RUNNING (${active_state})" ;;
    esac

    case "${enabled_state}" in
        enabled|enabled-runtime) echo "Boot:     ENABLED" ;;
        *) echo "Boot:     DISABLED (${enabled_state})" ;;
    esac

    [[ -n "${since}" && "${active_state}" == "active" ]] && echo "Since:    ${since}"
    echo "Restarts: ${nrestarts}"
    echo "Unit:     ${UNIT_FILE}"
    echo ""
    do_ports
}

do_ports() {
    local ports=() port label holders pid
    mapfile -t ports < <(known_ports)

    for port in "${ports[@]}"; do
        label=""
        [[ "${port}" == "${SITE_PORT}" ]] && label=" (site)"
        [[ "${port}" == "${ADMIN_PORT}" ]] && label=" (admin)"
        mapfile -t holders < <(port_pids "${port}")
        if [[ ${#holders[@]} -eq 0 ]]; then
            echo "Port ${port}${label}: free"
            continue
        fi
        for pid in "${holders[@]}"; do
            if is_mine "${pid}"; then
                echo "Port ${port}${label}: THIS service (pid ${pid})"
            elif belongs_to_project "${pid}"; then
                echo "Port ${port}${label}: orphan from this project (pid ${pid})"
                echo "    $(describe_pid "${pid}")"
            else
                echo "Port ${port}${label}: FOREIGN — do not kill blindly (pid ${pid})"
                echo "    $(describe_pid "${pid}")"
            fi
        done
    done
}

do_cleanup() {
    local ports=() targets=() foreign=() port pid holders
    mapfile -t ports < <(known_ports)

    for port in "${ports[@]}"; do
        mapfile -t holders < <(port_pids "${port}")
        for pid in "${holders[@]:-}"; do
            [[ -z "${pid}" || "${pid}" == "1" ]] && continue
            is_mine "${pid}" && continue
            if belongs_to_project "${pid}"; then
                targets+=("${pid}")
            else
                foreign+=("${pid}")
            fi
        done
    done

    while read -r pid; do
        [[ -z "${pid}" ]] && continue
        is_mine "${pid}" && continue
        targets+=("${pid}")
    done < <(project_pids)

    mapfile -t targets < <(printf '%s\n' "${targets[@]:-}" | grep -E '^[0-9]+$' | sort -un)
    mapfile -t foreign < <(printf '%s\n' "${foreign[@]:-}" | grep -E '^[0-9]+$' | sort -un)

    if [[ ${#foreign[@]} -gt 0 ]]; then
        echo "Skipping ${#foreign[@]} FOREIGN process(es) — not owned by ${TARGET_ROOT}:"
        for pid in "${foreign[@]}"; do
            echo "  pid ${pid} — $(describe_pid "${pid}")"
        done
        echo "These are likely another site. Stop their owning unit yourself if intended."
        echo ""
    fi

    if [[ ${#targets[@]} -eq 0 ]]; then
        echo "No orphans belonging to this project."
        return
    fi

    for pid in "${targets[@]}"; do
        mapfile -t pp < <(pid_ports "${pid}")
        if [[ ${#pp[@]} -gt 0 ]]; then
            echo "  pid ${pid} [listening: ${pp[*]}] — $(describe_pid "${pid}")"
        else
            echo "  pid ${pid} — $(describe_pid "${pid}")"
        fi
    done
    echo ""
    read -rp "Kill these ${#targets[@]} project-owned process(es)? [y/N]: " confirm
    if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        return
    fi

    kill_pids "${targets[@]}"
    echo "Cleanup complete."
    echo ""
    do_ports
}

do_list_units() {
    echo "Units whose WorkingDirectory is ${PROJ_PATH}:"
    local found=0 base workdir state
    for unit in /etc/systemd/system/*.service; do
        [[ -e "${unit}" ]] || continue
        base="$(basename "${unit}" .service)"
        workdir="$(sed -n 's/^WorkingDirectory=//p' "${unit}" | head -n1)"
        [[ "${workdir}" == "${PROJ_PATH}" ]] || continue
        found=1
        state="$(systemctl is-active "${base}" 2>/dev/null | head -n1 || echo unknown)"
        if [[ "${base}" == "${SERVICE_NAME}" ]]; then
            echo "  * ${base}.service (${state}) — active registration"
        else
            echo "    ${base}.service (${state}) — duplicate"
        fi
    done
    [[ "${found}" -eq 0 ]] && echo "  none"
    echo ""
    echo "Remove extras with: sudo ./scripts/run.sh"
}

echo "Service: ${SERVICE_NAME}"
echo "Unit:    ${UNIT_NAME}"
echo "Project: ${TARGET_ROOT}"
echo "Command: ${UNIT_EXEC:-unknown}"
echo "User:    ${UNIT_USER:-root}"
echo "Ports:   ${SITE_PORT} (site) / ${ADMIN_PORT} (admin)"

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
echo "5) View live server logs (current run)"
echo "6) View live service logs"
echo "7) Status"
echo "8) Restart"
echo "9) Ports"
echo "10) Clean up project orphans"
echo "11) List units for this project"
echo "12) View server logs (all history)"
read -rp "Choose an option [1-12]: " choice

case "${choice}" in
    1) do_stop ;;
    2) do_disable ;;
    3) do_start ;;
    4) do_enable ;;
    5) do_server_logs ;;
    6) do_service_logs ;;
    7) do_status ;;
    8) do_restart ;;
    9) do_ports ;;
    10) do_cleanup ;;
    11) do_list_units ;;
    12) do_server_history ;;
    *) echo "Invalid option" ;;
esac
