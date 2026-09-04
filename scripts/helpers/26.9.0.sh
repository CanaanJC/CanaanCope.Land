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

rename_in_columns() {
    local file="$1" old="$2" new="$3"
    local tmp="${file}.tmp-$$"

    local has_old has_new
    has_old="$(jq --arg o "${old}" '[.columns[] | any(.[]; . == $o)] | any' "${file}")"

    if [[ "${has_old}" != "true" ]]; then
        echo "helper 26.9.0: no reference to \"${old}\" found — skipping."
        return 0
    fi

    has_new="$(jq --arg n "${new}" '[.columns[] | any(.[]; . == $n)] | any' "${file}")"

    if [[ "${has_new}" == "true" ]]; then
        echo "helper 26.9.0: \"${new}\" already present — removing stale \"${old}\" entry instead of duplicating."
        jq --arg o "${old}" '.columns |= map(map(select(. != $o)))' "${file}" > "${tmp}"
    else
        echo "helper 26.9.0: renaming \"${old}\" → \"${new}\" in admin panel layout..."
        jq --arg o "${old}" --arg n "${new}" '.columns |= map(map(if . == $o then $n else . end))' "${file}" > "${tmp}"
    fi

    mv "${tmp}" "${file}"
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

mkdir -p "${BACKUP_DIR}"

echo "helper 26.9.0: backing up ${MASTER_JSON} before making changes..."
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
        jq '.theme' "${MASTER_JSON}" > "${THEME_JSON}.tmp-$$"
        mv "${THEME_JSON}.tmp-$$" "${THEME_JSON}"
        echo "helper 26.9.0: ${THEME_JSON} created."
    fi

    echo "helper 26.9.0: removing theme section from ${MASTER_JSON}..."
    jq 'del(.theme)' "${MASTER_JSON}" > "${MASTER_JSON}.tmp-$$"
    mv "${MASTER_JSON}.tmp-$$" "${MASTER_JSON}"

    STILL_HAS_THEME="$(jq 'has("theme")' "${MASTER_JSON}")"
    if [[ "${STILL_HAS_THEME}" == "true" ]]; then
        echo "helper 26.9.0: WARNING — ${MASTER_JSON} still has a \"theme\" key after trim attempt. Check manually." >&2
    else
        echo "helper 26.9.0: ${MASTER_JSON} trimmed and verified."
    fi
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

echo "helper 26.9.0: checking admin panel layout for stale element names..."

RENAME_OLD=("admin-master.json" "library-editor" "sidebar.json" "topbar.json" "master.json")
RENAME_NEW=("Admin"              "Libraries"      "SideBar"      "TopBar"      "Master")

for i in "${!RENAME_OLD[@]}"; do
    rename_in_columns "${ADMIN_MASTER_JSON}" "${RENAME_OLD[$i]}" "${RENAME_NEW[$i]}"
done

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
    )' "${ADMIN_MASTER_JSON}" > "${ADMIN_MASTER_JSON}.tmp-$$"
    mv "${ADMIN_MASTER_JSON}.tmp-$$" "${ADMIN_MASTER_JSON}"
    echo "helper 26.9.0: admin panel layout updated — Theme now appears next to Master."
fi

echo "helper 26.9.0: final admin panel layout:"
jq '.columns' "${ADMIN_MASTER_JSON}"

echo "helper 26.9.0: migration complete."
