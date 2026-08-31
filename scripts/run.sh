#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"
STATE_DIR="${PROJECT_ROOT}/scripts"
SERVICE_NAME_FILE="${STATE_DIR}/service-name.txt"
SERVICE_META_FILE="${STATE_DIR}/service-meta.env"
MASTER_JSON="${PROJECT_ROOT}/config/master.json"
ENTRY_POINT="${PROJECT_ROOT}/node.js"
SELF_PID="$$"

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

if [[ ! -f "${ENTRY_POINT}" ]]; then
    echo ""
    echo "run.sh: ${ENTRY_POINT} not found — is this the project root? Aborting." >&2
    exit 1
fi

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
    local pid="$1" line
    line="$(grep -o '[^/]*\.service' "/proc/${pid}/cgroup" 2>/dev/null | head -n1 || true)"
    echo "${line}"
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
        if [[ "${cwd}" == "${PROJECT_ROOT}" || "${cmd}" == *"${PROJECT_ROOT}/node.js"* ]]; then
            echo "${pid}"
        fi
    done
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

read_port() {
    local key="$1" fallback="$2" value=""
    if [[ -f "${MASTER_JSON}" ]]; then
        value="$(jq -r ".hosting.${key} // empty" "${MASTER_JSON}" 2>/dev/null || true)"
    fi
    [[ -z "${value}" || "${value}" == "null" ]] && value="${fallback}"
    echo "${value}"
}

belongs_to_project() {
    local pid="$1" cwd cmd
    cwd="$(pid_cwd "${pid}")"
    cmd="$(pid_cmdline "${pid}")"
    [[ "${cwd}" == "${PROJECT_ROOT}" || "${cmd}" == *"${PROJECT_ROOT}/node.js"* ]]
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

collect_project_units() {
    local unit base workdir exec_line
    for unit in /etc/systemd/system/*.service; do
        [[ -e "${unit}" ]] || continue
        base="$(basename "${unit}" .service)"
        workdir="$(sed -n 's/^WorkingDirectory=//p' "${unit}" | head -n1)"
        exec_line="$(sed -n 's/^ExecStart=//p' "${unit}" | head -n1)"
        if [[ "${workdir}" == "${PROJECT_ROOT}" ]] || [[ "${exec_line}" == *"${PROJECT_ROOT}/node.js"* ]]; then
            echo "${base}"
        fi
    done
}

remove_unit() {
    local name="$1"
    systemctl stop "${name}" 2>/dev/null || true
    systemctl disable "${name}" 2>/dev/null || true
    systemctl reset-failed "${name}" 2>/dev/null || true
    rm -f "/etc/systemd/system/${name}.service"
    rm -f "/etc/systemd/system/multi-user.target.wants/${name}.service"
}

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
echo "run.sh: scanning for existing units tied to THIS project path..."

mapfile -t EXISTING_UNITS < <(collect_project_units | sort -u)

if [[ ${#EXISTING_UNITS[@]} -gt 0 ]]; then
    for unit in "${EXISTING_UNITS[@]}"; do
        wd="$(sed -n 's/^WorkingDirectory=//p' "/etc/systemd/system/${unit}.service" | head -n1)"
        state="$(systemctl is-active "${unit}" 2>/dev/null | head -n1 || echo unknown)"
        if [[ -n "${wd}" && ! -d "${wd}" ]]; then
            echo "  [stale]  ${unit} (${state}) — WorkingDirectory missing: ${wd}"
        else
            echo "  [found]  ${unit} (${state}) — ${wd}"
        fi
    done
else
    echo "run.sh: none found."
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
    EXISTING_WD="$(sed -n 's/^WorkingDirectory=//p' "${UNIT_PATH}" | head -n1)"
    echo ""
    echo "run.sh: a service named \"${SERVICE_NAME}\" already exists at ${UNIT_PATH}."
    echo "        its WorkingDirectory is: ${EXISTING_WD:-unknown}"
    if [[ -n "${EXISTING_WD}" && "${EXISTING_WD}" != "${PROJECT_ROOT}" && -d "${EXISTING_WD}" ]]; then
        echo ""
        echo "        DANGER: that is a DIFFERENT, EXISTING install — overwriting will hijack it."
        read -rp "        Type the service name again to confirm overwrite: " confirm_name
        if [[ "${confirm_name}" != "${SERVICE_NAME}" ]]; then
            echo "run.sh: aborting — no changes made."
            exit 1
        fi
    else
        read -rp "Overwrite it? [y/N]: " confirm_overwrite
        if [[ ! "${confirm_overwrite}" =~ ^[Yy]$ ]]; then
            echo "run.sh: aborting — no changes made."
            exit 1
        fi
    fi
    systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
    systemctl reset-failed "${SERVICE_NAME}" 2>/dev/null || true
fi

OBSOLETE=()
for unit in "${EXISTING_UNITS[@]:-}"; do
    [[ -z "${unit}" ]] && continue
    [[ "${unit}" == "${SERVICE_NAME}" ]] && continue
    OBSOLETE+=("${unit}")
done

if [[ -n "${PREVIOUS_SERVICE_NAME}" && "${PREVIOUS_SERVICE_NAME}" != "${SERVICE_NAME}" ]]; then
    if [[ -f "/etc/systemd/system/${PREVIOUS_SERVICE_NAME}.service" ]]; then
        PREV_WD="$(sed -n 's/^WorkingDirectory=//p' "/etc/systemd/system/${PREVIOUS_SERVICE_NAME}.service" | head -n1)"
        if [[ "${PREV_WD}" == "${PROJECT_ROOT}" || ! -d "${PREV_WD}" ]]; then
            already=0
            for unit in "${OBSOLETE[@]:-}"; do
                [[ "${unit}" == "${PREVIOUS_SERVICE_NAME}" ]] && already=1
            done
            [[ "${already}" -eq 0 ]] && OBSOLETE+=("${PREVIOUS_SERVICE_NAME}")
        fi
    fi
fi

if [[ ${#OBSOLETE[@]} -gt 0 ]]; then
    echo ""
    echo "run.sh: these other units point at THIS project path (or a dead copy of it):"
    for unit in "${OBSOLETE[@]}"; do
        wd="$(sed -n 's/^WorkingDirectory=//p' "/etc/systemd/system/${unit}.service" | head -n1)"
        echo "    ${unit}.service — ${wd:-unknown}"
    done
    read -rp "Stop, disable, and delete all of them? [Y/n]: " confirm_cleanup
    if [[ ! "${confirm_cleanup}" =~ ^[Nn]$ ]]; then
        for unit in "${OBSOLETE[@]}"; do
            remove_unit "${unit}"
            echo "run.sh: removed /etc/systemd/system/${unit}.service"
        done
        systemctl daemon-reload
    else
        echo "run.sh: leaving them in place (they may fight over ports)."
    fi
fi

SITE_PORT="$(read_port port 9138)"
ADMIN_PORT="$(read_port adminPort 9832)"

echo ""
echo "run.sh: scanning for stray processes belonging to THIS project..."
echo "run.sh: (matched by /proc cwd and exe, so rewritten process titles are still caught)"

mapfile -t STRAYS < <(project_pids | sort -un)

if [[ ${#STRAYS[@]} -gt 0 ]]; then
    echo ""
    for pid in "${STRAYS[@]}"; do
        mapfile -t pports < <(pid_ports "${pid}")
        if [[ ${#pports[@]} -gt 0 ]]; then
            echo "  pid ${pid} [listening: ${pports[*]}]"
        else
            echo "  pid ${pid}"
        fi
        echo "      $(describe_pid "${pid}")"
    done
    echo ""
    read -rp "Kill these ${#STRAYS[@]} process(es)? [Y/n]: " confirm_kill
    if [[ ! "${confirm_kill}" =~ ^[Nn]$ ]]; then
        kill_pids "${STRAYS[@]}"
        echo "run.sh: strays cleared."
    else
        echo "run.sh: leaving them running — expect EADDRINUSE."
    fi
else
    echo "run.sh: none found."
fi

echo ""
echo "run.sh: verifying ports ${SITE_PORT} (site) and ${ADMIN_PORT} (admin)..."

SAFE_TO_KILL=()
FOREIGN=()

for port in "${SITE_PORT}" "${ADMIN_PORT}"; do
    mapfile -t holders < <(port_pids "${port}")
    if [[ ${#holders[@]} -eq 0 ]]; then
        echo "  [free] ${port}"
        continue
    fi
    for pid in "${holders[@]}"; do
        if belongs_to_project "${pid}"; then
            echo "  [busy] ${port} — pid ${pid} belongs to this project"
            echo "         $(describe_pid "${pid}")"
            SAFE_TO_KILL+=("${pid}")
        else
            echo "  [busy] ${port} — pid ${pid} belongs to SOMETHING ELSE"
            echo "         $(describe_pid "${pid}")"
            FOREIGN+=("${pid}")
        fi
    done
done

if [[ ${#SAFE_TO_KILL[@]} -gt 0 ]]; then
    echo ""
    mapfile -t SAFE_TO_KILL < <(printf '%s\n' "${SAFE_TO_KILL[@]}" | sort -un)
    read -rp "Kill the ${#SAFE_TO_KILL[@]} process(es) owned by this project? [Y/n]: " confirm_safe
    if [[ ! "${confirm_safe}" =~ ^[Nn]$ ]]; then
        kill_pids "${SAFE_TO_KILL[@]}"
        echo "run.sh: released."
    fi
fi

if [[ ${#FOREIGN[@]} -gt 0 ]]; then
    mapfile -t FOREIGN < <(printf '%s\n' "${FOREIGN[@]}" | sort -un)
    echo ""
    echo "run.sh: REFUSING to auto-kill ${#FOREIGN[@]} foreign process(es) on your ports."
    echo "        these are almost certainly another live site or install."
    echo "        change hosting.port / hosting.adminPort in config/master.json instead,"
    echo "        or stop the owning service yourself."
    echo ""
    read -rp "Continue anyway (this install will fail to bind)? [y/N]: " confirm_continue
    if [[ ! "${confirm_continue}" =~ ^[Yy]$ ]]; then
        echo "run.sh: aborting — no unit file written."
        exit 1
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
SITE_PORT=${SITE_PORT}
ADMIN_PORT=${ADMIN_PORT}
EOF

if [[ "${INVOKING_USER}" != "root" ]]; then
    chown "${INVOKING_USER}:${INVOKING_USER}" "${SERVICE_NAME_FILE}" "${SERVICE_META_FILE}" 2>/dev/null || true
fi

echo ""
echo "run.sh: saved service name to ${SERVICE_NAME_FILE}"
echo "run.sh: saved service metadata to ${SERVICE_META_FILE}"

echo ""
echo "run.sh: writing ${UNIT_PATH}..."

cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=${SERVICE_NAME} (canaancope.dev server)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

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

sleep 3

echo ""
echo "run.sh: done. Current status:"
echo ""
systemctl status "${SERVICE_NAME}" --no-pager -l || true

if ! systemctl is-active --quiet "${SERVICE_NAME}"; then
    INVOCATION="$(systemctl show -p InvocationID --value "${SERVICE_NAME}" 2>/dev/null || true)"
    echo ""
    echo "run.sh: the service did not stay up. Output from THIS run only:"
    echo ""
    if [[ -n "${INVOCATION}" ]]; then
        journalctl _SYSTEMD_INVOCATION_ID="${INVOCATION}" -o cat --no-pager || true
    else
        journalctl -u "${SERVICE_NAME}.service" -t "${SERVICE_NAME}" -o cat -n 40 --no-pager || true
    fi
fi

echo ""
echo "run.sh: use ./scripts/service.sh to control this service going forward."
