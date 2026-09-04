#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
PROJECT_ROOT="$(pwd)"

MASTER_JSON="config/master.json"
THEME_JSON="config/theme.json"
BACKUP_DIR="config/backup"
ADMIN_MASTER_JSON="ADMIN/config/master.json"

timestamp() {
    date +"%Y-%m-%dT%H-%M-%S"
}

echo "helper 26.9.0: starting theme-engine migration"

if [[ ! -f "${MASTER_JSON}" ]]; then
    echo "helper 26.9.0: ${MASTER_JSON} not found — nothing to migrate, skipping."
    exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "helper 26.9.0: jq not found — cannot perform migration. Aborting helper (main update still applied)." >&2
    exit 1
fi

echo "helper 26.9.0: backing up ${MASTER_JSON} before making changes..."
mkdir -p "${BACKUP_DIR}"
STAMP="$(timestamp)"
BACKUP_PATH="${BACKUP_DIR}/${STAMP}-master-pre-theme-split.json"
cp -f "${MASTER_JSON}" "${BACKUP_PATH}"
echo "helper 26.9.0: backup saved to ${BACKUP_PATH}"

HAS_THEME_KEY="$(jq 'has("theme")' "${MASTER_JSON}")"

if [[ "${HAS_THEME_KEY}" != "true" ]]; then
    echo "helper 26.9.0: ${MASTER_JSON} has no \"theme\" key — already migrated or never had one, skipping split."
else
    if [[ -f "${THEME_JSON}" ]]; then
        echo "helper 26.9.0: ${THEME_JSON} already exists — leaving it untouched, will still trim master.json."
    else
        echo "helper 26.9.0: creating ${THEME_JSON} from master.json's theme section..."
        jq '.theme' "${MASTER_JSON}" > "${THEME_JSON}.tmp"
        mv "${THEME_JSON}.tmp" "${THEME_JSON}"
        echo "helper 26.9.0: ${THEME_JSON} created."
    fi

    echo "helper 26.9.0: removing theme section from ${MASTER_JSON}..."
    jq 'del(.theme)' "${MASTER_JSON}" > "${MASTER_JSON}.tmp"
    mv "${MASTER_JSON}.tmp" "${MASTER_JSON}"
    echo "helper 26.9.0: ${MASTER_JSON} trimmed."
fi

if [[ ! -f "${ADMIN_MASTER_JSON}" ]]; then
    echo "helper 26.9.0: ${ADMIN_MASTER_JSON} not found — no admin panel installed, skipping panel patch."
    echo "helper 26.9.0: migration complete."
    exit 0
fi

echo "helper 26.9.0: backing up ${ADMIN_MASTER_JSON} before making changes..."
STAMP2="$(timestamp)"
ADMIN_BACKUP_PATH="${BACKUP_DIR}/${STAMP2}-admin-master-pre-rename.json"
cp -f "${ADMIN_MASTER_JSON}" "${ADMIN_BACKUP_PATH}"
echo "helper 26.9.0: backup saved to ${ADMIN_BACKUP_PATH}"

declare -A RENAMES=(
    ["admin-master.json"]="Admin"
    ["library-editor"]="Libraries"
    ["sidebar.json"]="SideBar"
    ["topbar.json"]="TopBar"
    ["master.json"]="Master"
)

echo "helper 26.9.0: checking admin panel layout for stale element names..."

CURRENT_JSON="$(cat "${ADMIN_MASTER_JSON}")"

for old_name in "${!RENAMES[@]}"; do
    new_name="${RENAMES[${old_name}]}"
    FOUND="$(echo "${CURRENT_JSON}" | jq --arg o "${old_name}" '[.columns[] | any(.[]; . == $o)] | any')"
    if [[ "${FOUND}" == "true" ]]; then
        echo "helper 26.9.0: renaming \"${old_name}\" → \"${new_name}\" in admin panel layout..."
        CURRENT_JSON="$(echo "${CURRENT_JSON}" | jq --arg o "${old_name}" --arg n "${new_name}" \
            '.columns |= map(map(if . == $o then $n else . end))')"
    else
        echo "helper 26.9.0: no reference to \"${old_name}\" found — skipping."
    fi
done

echo "${CURRENT_JSON}" > "${ADMIN_MASTER_JSON}.tmp"
mv "${ADMIN_MASTER_JSON}.tmp" "${ADMIN_MASTER_JSON}"

echo "helper 26.9.0: checking admin panel layout for a Theme entry..."

ALREADY_HAS_THEME="$(jq '[.columns[] | any(.[]; . == "Theme")] | any' "${ADMIN_MASTER_JSON}")"
HAS_MASTER_ENTRY="$(jq '[.columns[] | any(.[]; . == "Master")] | any' "${ADMIN_MASTER_JSON}")"

if [[ "${ALREADY_HAS_THEME}" == "true" ]]; then
    echo "helper 26.9.0: admin panel already has a Theme entry — leaving layout untouched."
elif [[ "${HAS_MASTER_ENTRY}" != "true" ]]; then
    echo "helper 26.9.0: admin panel has no \"Master\" entry to anchor next to — leaving layout untouched."
    echo "helper 26.9.0: add a \"Theme\" entry to ${ADMIN_MASTER_JSON} manually if you want it in the panel."
else
    echo "helper 26.9.0: inserting Theme entry next to Master in admin panel layout..."
    jq '.columns |= map(
        if any(.[]; . == "Master") then
            reduce .[] as $item ([];
                . + [$item] + (if $item == "Master" then ["Theme"] else [] end)
            )
        else
            .
        end
    )' "${ADMIN_MASTER_JSON}" > "${ADMIN_MASTER_JSON}.tmp"
    mv "${ADMIN_MASTER_JSON}.tmp" "${ADMIN_MASTER_JSON}"
    echo "helper 26.9.0: admin panel layout updated — Theme now appears next to Master."
fi

echo "helper 26.9.0: migration complete."
