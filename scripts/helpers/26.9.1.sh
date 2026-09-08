#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"

if [[ "${EUID}" -ne 0 ]]; then
    exec sudo -- bash "${SCRIPT_PATH}" "$@"
fi

PROJECT_ROOT="$(cd -- "$(dirname -- "${SCRIPT_PATH}")/../.." && pwd)"
cd -- "${PROJECT_ROOT}"

fail() {
    printf '26.9.1: %s\n' "$*" >&2
    exit 1
}

for cmd in jq mktemp cp mv chmod mkdir cmp sed tr; do
    command -v "${cmd}" >/dev/null 2>&1 || fail "Missing dependency: ${cmd}"
done

FILES=(
    "config/master.json"
    "ADMIN/config/master.json"
    "config/theme.json"
)

for rel in "${FILES[@]}"; do
    [[ -f "${rel}" && ! -L "${rel}" ]] || fail "Expected a regular, non-symlink file: ${rel}"
    jq -e 'type == "object"' "${rel}" >/dev/null || fail "Expected a JSON object: ${rel}"
done

jq -e '
    (.columns | type) == "array"
    and all(.columns[]; type == "array")
' "ADMIN/config/master.json" >/dev/null || fail "Invalid admin columns layout."

jq -e '
    ((has("body") | not) or (.body | type) == "object")
    and ((has("code") | not) or (.code | type) == "object")
' "config/theme.json" >/dev/null || fail "Invalid theme body or code section."

SERVICE_NAME_FILE=""
SERVICE_NAME=""
UNIT=""
DROPIN_DIR=""
DROPIN_PATH=""
META_PATH="scripts/service-meta.env"

if [[ -f "scripts/service-name.txt" ]]; then
    SERVICE_NAME_FILE="scripts/service-name.txt"
elif [[ -f "scripts/.service-name" ]]; then
    SERVICE_NAME_FILE="scripts/.service-name"
fi

if [[ -n "${SERVICE_NAME_FILE}" ]]; then
    for cmd in systemctl ps readlink; do
        command -v "${cmd}" >/dev/null 2>&1 || fail "Missing dependency: ${cmd}"
    done

    SERVICE_NAME="$(tr -d '[:space:]' < "${SERVICE_NAME_FILE}")"
    SERVICE_NAME="${SERVICE_NAME%.service}"

    [[ "${SERVICE_NAME}" =~ ^[a-zA-Z0-9_-]+$ ]] || fail "Invalid or empty service name."

    UNIT="${SERVICE_NAME}.service"
    LOAD_STATE="$(systemctl show "${UNIT}" -p LoadState --value)"
    [[ "${LOAD_STATE}" == "loaded" ]] || fail "${UNIT} is not loaded: ${LOAD_STATE}"

    WORKING_DIRECTORY="$(systemctl show "${UNIT}" -p WorkingDirectory --value)"
    [[ -n "${WORKING_DIRECTORY}" ]] || fail "${UNIT} has no WorkingDirectory."

    RESOLVED_DIRECTORY="$(readlink -f -- "${WORKING_DIRECTORY}")"
    [[ "${RESOLVED_DIRECTORY}" == "${PROJECT_ROOT}" ]] || fail "${UNIT} belongs to a different project: ${WORKING_DIRECTORY}"

    DROPIN_DIR="/etc/systemd/system/${UNIT}.d"
    DROPIN_PATH="${DROPIN_DIR}/zz-26.9.1-root.conf"

    [[ ! -L "${DROPIN_DIR}" ]] || fail "Refusing symlink directory: ${DROPIN_DIR}"
    [[ ! -L "${DROPIN_PATH}" ]] || fail "Refusing symlink file: ${DROPIN_PATH}"
    [[ ! -e "${DROPIN_PATH}" || -f "${DROPIN_PATH}" ]] || fail "Invalid override path."

    if [[ -e "${META_PATH}" ]]; then
        [[ -f "${META_PATH}" && ! -L "${META_PATH}" ]] || fail "Invalid service metadata file."
    fi
fi

BACKUP_BASE="${PROJECT_ROOT}/scripts/.migration-backups"
[[ ! -L "${BACKUP_BASE}" ]] || fail "Refusing symlink backup directory."

mkdir -p -- "${BACKUP_BASE}"
chmod 700 -- "${BACKUP_BASE}"
BACKUP_DIR="$(mktemp -d "${BACKUP_BASE}/26.9.1.XXXXXXXX")"
STAGING="$(mktemp -d "${PROJECT_ROOT}/scripts/.26.9.1-stage.XXXXXXXX")"
TEMP_PATH=""

cleanup() {
    if [[ -n "${TEMP_PATH}" ]]; then
        rm -f -- "${TEMP_PATH}"
    fi
    rm -rf -- "${STAGING}"
}

trap cleanup EXIT

for rel in "${FILES[@]}"; do
    mkdir -p -- "${BACKUP_DIR}/$(dirname -- "${rel}")"
    cp -p -- "${rel}" "${BACKUP_DIR}/${rel}"
done

jq --indent 4 'del(.theme)' \
    "config/master.json" > "${STAGING}/master.json"

jq --indent 4 '
    def rename_admin:
        if type == "array" then
            map(rename_admin)
        elif . == "Admin" then
            "pannel_config"
        else
            .
        end;
    .columns |= rename_admin
' "ADMIN/config/master.json" > "${STAGING}/admin.json"

jq --indent 4 '
    del(.body.dividerColor, .code.borderColor, .code.backgroundColor)
' "config/theme.json" > "${STAGING}/theme.json"

if [[ -n "${UNIT}" ]]; then
    systemctl cat "${UNIT}" > "${BACKUP_DIR}/service-effective-before.txt"

    if [[ -f "${DROPIN_PATH}" ]]; then
        cp -p -- "${DROPIN_PATH}" "${BACKUP_DIR}/root-override-before.conf"
    else
        printf '%s\n' "${DROPIN_PATH}" > "${BACKUP_DIR}/new-override-path.txt"
    fi

    printf '%s\n' \
        '[Service]' \
        'User=root' \
        'Group=root' \
        'DynamicUser=no' > "${STAGING}/root.conf"

    if [[ -f "${META_PATH}" ]]; then
        cp -p -- "${META_PATH}" "${BACKUP_DIR}/service-meta.env"
        sed '/^[[:space:]]*RUN_AS_USER=/d' "${META_PATH}" > "${STAGING}/service-meta.env"
        printf '\nRUN_AS_USER=root\n' >> "${STAGING}/service-meta.env"
    fi
fi

write_file() {
    local source="$1" destination="$2"

    if [[ -f "${destination}" ]] && cmp -s -- "${source}" "${destination}"; then
        return 0
    fi

    TEMP_PATH="$(mktemp "$(dirname -- "${destination}")/.26.9.1.XXXXXXXX")"

    if [[ -f "${destination}" ]]; then
        cp -p -- "${destination}" "${TEMP_PATH}"
    else
        chmod 644 -- "${TEMP_PATH}"
    fi

    cat -- "${source}" > "${TEMP_PATH}"
    mv -f -- "${TEMP_PATH}" "${destination}"
    TEMP_PATH=""

    printf '26.9.1: updated %s\n' "${destination}"
}

printf '26.9.1: backups saved to %s\n' "${BACKUP_DIR}"

write_file "${STAGING}/master.json" "config/master.json"
write_file "${STAGING}/admin.json" "ADMIN/config/master.json"
write_file "${STAGING}/theme.json" "config/theme.json"

if [[ -n "${UNIT}" ]]; then
    mkdir -p -- "${DROPIN_DIR}"
    write_file "${STAGING}/root.conf" "${DROPIN_PATH}"

    systemctl daemon-reload

    EFFECTIVE_USER="$(systemctl show "${UNIT}" -p User --value)"
    EFFECTIVE_GROUP="$(systemctl show "${UNIT}" -p Group --value)"
    DYNAMIC_USER="$(systemctl show "${UNIT}" -p DynamicUser --value)"

    [[ "${EFFECTIVE_USER}" == "root" ]] || fail "Another override prevents User=root."
    [[ "${EFFECTIVE_GROUP}" == "root" ]] || fail "Another override prevents Group=root."
    [[ "${DYNAMIC_USER}" == "no" ]] || fail "Another override enables DynamicUser."

    if [[ -f "${STAGING}/service-meta.env" ]]; then
        write_file "${STAGING}/service-meta.env" "${META_PATH}"
    fi

    systemctl reset-failed "${UNIT}"
    systemctl restart "${UNIT}"
    sleep 3

    systemctl is-active --quiet "${UNIT}" || fail "${UNIT} did not remain active. Check journalctl -u ${UNIT}."

    MAIN_PID="$(systemctl show "${UNIT}" -p MainPID --value)"
    [[ "${MAIN_PID}" =~ ^[1-9][0-9]*$ ]] || fail "${UNIT} has no running main process."

    PROCESS_UID="$(ps -o euid= -p "${MAIN_PID}" | tr -d '[:space:]')"
    [[ "${PROCESS_UID}" == "0" ]] || fail "${UNIT} main process is not running as root."

    printf '26.9.1: %s is active as root, PID %s.\n' "${UNIT}" "${MAIN_PID}"
else
    printf '26.9.1: no saved service name; service migration skipped.\n'
fi

printf '26.9.1: migration complete.\n'