#!/usr/bin/env bash

if [ -z "${BASH_VERSION:-}" ]; then
    echo "update.sh: this script requires bash — it won't run correctly under sh/dash." >&2
    echo "           run it as: bash scripts/update.sh   (or: ./scripts/update.sh)" >&2
    exit 1
fi

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"

GITHUB_OWNER="CanaanJC"
GITHUB_REPO="CanaanCope.Land"

VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"
MASTER_CONFIG_FILE="config/master.json"
SELF_REL_PATH="scripts/update.sh"
TMP_DIR="scripts/.tmp-update"
HELPERS_DIR="scripts/helpers"
BACKUP_TIMEOUT_SECS=600
DOWNLOAD_CONNECT_TIMEOUT=15
DOWNLOAD_MAX_TIME=300

VERBOSE=false

if [[ "${1:-}" == "verbose" ]]; then
    VERBOSE=true
fi

vecho() {
    if [[ "${VERBOSE}" == true ]]; then
        echo "$@"
    fi
}

version_gt() {
    local a="$1" b="$2"
    if [[ "${a}" == "${b}" ]]; then return 1; fi
    local higher
    higher="$(printf '%s\n%s\n' "${a}" "${b}" | sort -V | tail -n1)"
    [[ "${higher}" == "${a}" ]]
}

in_version_range() {
    local ver="$1" low="$2" high="$3"

    if [[ "${ver}" == "${low}" ]]; then
        return 1
    fi

    local lowest
    lowest="$(printf '%s\n%s\n' "${ver}" "${low}" | sort -V | head -n1)"
    if [[ "${lowest}" == "${ver}" ]]; then
        return 1
    fi

    local highest
    highest="$(printf '%s\n%s\n' "${ver}" "${high}" | sort -V | tail -n1)"
    if [[ "${highest}" == "${ver}" ]] && [[ "${ver}" != "${high}" ]]; then
        return 1
    fi

    return 0
}

vecho "update.sh: checking dependencies..."

REQUIRED_CMDS=(curl jq tar node)
MISSING_CMDS=()

for cmd in "${REQUIRED_CMDS[@]}"; do
    if command -v "${cmd}" >/dev/null 2>&1; then
        vecho "  [ok] ${cmd}"
    else
        echo "  [missing] ${cmd}"
        MISSING_CMDS+=("${cmd}")
    fi
done

if [[ ${#MISSING_CMDS[@]} -gt 0 ]]; then
    echo ""
    echo "The following required commands are missing: ${MISSING_CMDS[*]}"

    if ! command -v apt-get >/dev/null 2>&1; then
        echo "update.sh: apt-get not found — install the above manually and re-run." >&2
        exit 1
    fi

    read -rp "Install them now via 'sudo apt-get install'? [y/N]: " confirm_install
    if [[ ! "${confirm_install}" =~ ^[Yy]$ ]]; then
        echo "update.sh: cannot continue without these dependencies. Aborting."
        exit 1
    fi

    sudo apt-get update
    sudo apt-get install -y "${MISSING_CMDS[@]}"

    for cmd in "${MISSING_CMDS[@]}"; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            echo "update.sh: \"${cmd}\" still not found after installation attempt — aborting." >&2
            exit 1
        fi
    done
fi

JQ_DEEPMERGE='
def deepmerge($local; $new):
    if (($local | type) == "object") and (($new | type) == "object") then
        (reduce ($local | keys_unsorted[]) as $k
            ({};
                . + (
                    if ($new | has($k)) then
                        { ($k): deepmerge($local[$k]; $new[$k]) }
                    else
                        { ($k): $local[$k] }
                    end
                )
            )
        ) as $merged
        | reduce ($new | keys_unsorted[]) as $k2
            ($merged;
                if ($local | has($k2)) then .
                else . + { ($k2): $new[$k2] }
                end
            )
    else
        $local
    end;

deepmerge($local[0]; $new[0])
'

merge_json_file() {
    local rel="$1"
    local src="${EXTRACTED_ROOT}/${rel}"
    local dest="${PROJECT_ROOT}/${rel}"

    mkdir -p "$(dirname "${dest}")"

    if [[ -f "${dest}" ]] && jq empty "${dest}" >/dev/null 2>&1; then
        local tmp_out
        tmp_out="$(mktemp)"
        if jq -n -f <(printf '%s' "${JQ_DEEPMERGE}") --slurpfile local "${dest}" --slurpfile new "${src}" > "${tmp_out}" 2>/dev/null; then
            mv "${tmp_out}" "${dest}"
            vecho "  merged (existing fields/order untouched, new fields added): ${rel}"
        else
            rm -f "${tmp_out}"
            echo "  warning: merge failed for ${rel} — copying new version verbatim instead"
            cp -f "${src}" "${dest}"
        fi
    else
        cp -f "${src}" "${dest}"
        vecho "  added: ${rel}"
    fi
}

overwrite_json_file() {
    local rel="$1"
    local src="${EXTRACTED_ROOT}/${rel}"
    local dest="${PROJECT_ROOT}/${rel}"

    mkdir -p "$(dirname "${dest}")"
    cp -f "${src}" "${dest}"
    vecho "  overwritten (no merge, always replaced): ${rel}"
}

LOCAL_VERSION="0.0.0"
if [[ -f "${VERSION_FILE}" ]]; then
    LOCAL_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
    [[ -z "${LOCAL_VERSION}" ]] && LOCAL_VERSION="0.0.0"
fi

vecho ""
vecho "update.sh: local version is ${LOCAL_VERSION}"
vecho "update.sh: fetching all releases from GitHub (${GITHUB_OWNER}/${GITHUB_REPO})..."

RELEASES_JSON="$(curl -fsSL "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100")" || {
    echo "update.sh: failed to reach GitHub API — check your connection." >&2
    exit 1
}

mapfile -t ALL_VERSIONS < <(echo "${RELEASES_JSON}" | jq -r '.[].tag_name' | sed 's/^v//' | sort -V -u)

if [[ ${#ALL_VERSIONS[@]} -eq 0 ]]; then
    echo "update.sh: no releases found for ${GITHUB_OWNER}/${GITHUB_REPO} — aborting." >&2
    exit 1
fi

NEWER_VERSIONS=()
for v in "${ALL_VERSIONS[@]}"; do
    if version_gt "${v}" "${LOCAL_VERSION}"; then
        NEWER_VERSIONS+=("${v}")
    fi
done

if [[ ${#NEWER_VERSIONS[@]} -eq 0 ]]; then
    echo "update.sh: already up to date (${LOCAL_VERSION})."
    exit 0
fi

mapfile -t NEWER_VERSIONS < <(printf '%s\n' "${NEWER_VERSIONS[@]}" | sort -V)

NEXT_VERSION="${NEWER_VERSIONS[0]}"
TOTAL_NEWER=${#NEWER_VERSIONS[@]}
REMAINING_AFTER=$(( TOTAL_NEWER - 1 ))

NEXT_TAG="$(echo "${RELEASES_JSON}" | jq -r --arg v "${NEXT_VERSION}" '.[] | select((.tag_name | sub("^v";""))==$v) | .tag_name' | head -n1)"

if [[ -z "${NEXT_TAG}" ]]; then
    echo "update.sh: could not resolve a release tag for version ${NEXT_VERSION} — aborting." >&2
    exit 1
fi

vecho "update.sh: next version in line is ${NEXT_VERSION} (tag ${NEXT_TAG}) — ${TOTAL_NEWER} version(s) newer than local in total"

echo ""
echo "update.sh: update available: ${LOCAL_VERSION} → ${NEXT_VERSION} (next of ${TOTAL_NEWER} available update(s))"
read -rp "Proceed with this update? [y/N]: " confirm_update
if [[ ! "${confirm_update}" =~ ^[Yy]$ ]]; then
    echo "update.sh: cancelled — no changes made."
    exit 0
fi

vecho ""
vecho "update.sh: verifying a backup destination is configured..."

if [[ ! -f "${MASTER_CONFIG_FILE}" ]]; then
    echo "update.sh: ${MASTER_CONFIG_FILE} not found — cannot verify backup configuration. Aborting." >&2
    exit 1
fi

BACKUP_PATH_CONFIGURED="$(jq -r '.backup.path // ""' "${MASTER_CONFIG_FILE}" 2>/dev/null || echo "")"

if [[ -z "${BACKUP_PATH_CONFIGURED}" ]]; then
    echo "update.sh: backup.path is not configured in ${MASTER_CONFIG_FILE}." >&2
    echo "           this script refuses to update without a real, verified backup — set" >&2
    echo "           backup.path (via the Admin panel or directly in the config) and try again." >&2
    exit 1
fi

SITE_NAME="$(jq -r '.siteName // "site"' "${MASTER_CONFIG_FILE}" 2>/dev/null || echo "site")"
[[ -z "${SITE_NAME}" ]] && SITE_NAME="site"
SANITIZED_SITE_NAME="$(printf '%s' "${SITE_NAME}" | sed -E 's/[^a-zA-Z0-9._-]/_/g')"

BACKUP_ROOT="${BACKUP_PATH_CONFIGURED}/${SANITIZED_SITE_NAME}"
BACKUP_MANIFEST_PATH="${BACKUP_ROOT}/manifest.json"

echo "backing up"
vecho "update.sh: backup destination is \"${BACKUP_PATH_CONFIGURED}\" — running backup now"
vecho "update.sh: (hard timeout: ${BACKUP_TIMEOUT_SECS}s — treated as a failure if exceeded)"

BACKUP_TAG="update from ${LOCAL_VERSION} to ${NEXT_VERSION}"
BACKUP_LOG="$(mktemp)"

set +e
if [[ "${VERBOSE}" == true ]]; then
    timeout "${BACKUP_TIMEOUT_SECS}" node -e "
        const { performBackup } = require('${PROJECT_ROOT}/lib/backup.js');
        performBackup({ force: true, tag: process.argv[1] })
            .then(() => process.exit(0))
            .catch((e) => { console.error(e); process.exit(1); });
    " "${BACKUP_TAG}" 2>&1 | tee "${BACKUP_LOG}"
    BACKUP_EXIT_CODE=${PIPESTATUS[0]}
else
    timeout "${BACKUP_TIMEOUT_SECS}" node -e "
        const { performBackup } = require('${PROJECT_ROOT}/lib/backup.js');
        performBackup({ force: true, tag: process.argv[1] })
            .then(() => process.exit(0))
            .catch((e) => { console.error(e); process.exit(1); });
    " "${BACKUP_TAG}" >"${BACKUP_LOG}" 2>&1
    BACKUP_EXIT_CODE=$?
fi
set -e

if [[ ${BACKUP_EXIT_CODE} -eq 124 ]]; then
    [[ "${VERBOSE}" != true ]] && cat "${BACKUP_LOG}" >&2
    rm -f "${BACKUP_LOG}"
    echo "update.sh: backup TIMED OUT after ${BACKUP_TIMEOUT_SECS}s — aborting update. Nothing has been changed." >&2
    exit 1
elif [[ ${BACKUP_EXIT_CODE} -ne 0 ]]; then
    [[ "${VERBOSE}" != true ]] && cat "${BACKUP_LOG}" >&2
    rm -f "${BACKUP_LOG}"
    echo "update.sh: backup process FAILED (exit code ${BACKUP_EXIT_CODE}) — aborting update. Nothing has been changed." >&2
    exit 1
fi
rm -f "${BACKUP_LOG}"

vecho "update.sh: backup process reported success — verifying it actually exists on disk..."

if [[ ! -f "${BACKUP_MANIFEST_PATH}" ]]; then
    echo "update.sh: backup manifest not found at ${BACKUP_MANIFEST_PATH} — cannot verify backup. Aborting." >&2
    exit 1
fi

BACKUP_FOLDER_PATH="$(
    jq -r --arg tag "${BACKUP_TAG}" \
        '[.[] | select(.tag == $tag)] | sort_by(.timestamp) | last | .folderPath // empty' \
        "${BACKUP_MANIFEST_PATH}" 2>/dev/null || echo ""
)"

if [[ -z "${BACKUP_FOLDER_PATH}" ]]; then
    echo "update.sh: no backup manifest entry found with tag \"${BACKUP_TAG}\" — cannot verify backup. Aborting." >&2
    exit 1
fi

if [[ ! -d "${BACKUP_FOLDER_PATH}" ]]; then
    echo "update.sh: backup folder \"${BACKUP_FOLDER_PATH}\" does not exist on disk — backup verification FAILED. Aborting." >&2
    exit 1
fi

if [[ ! -f "${BACKUP_FOLDER_PATH}/node.js" ]]; then
    echo "update.sh: backup folder exists but looks incomplete (no node.js inside) — backup verification FAILED. Aborting." >&2
    exit 1
fi

if [[ "${VERBOSE}" == true ]]; then
    echo "update.sh: backup verified on disk at ${BACKUP_FOLDER_PATH}"
else
    echo "backup complete"
fi

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}"
trap 'rm -rf "${TMP_DIR}"' EXIT
vecho ""
vecho "update.sh: scratch/temp files for this run live at ${PROJECT_ROOT}/${TMP_DIR} (auto-deleted on exit, including Ctrl-C)"

vecho ""
vecho "update.sh: downloading release ${NEXT_TAG}..."

TARBALL_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/${NEXT_TAG}.tar.gz"
TARBALL_PATH="${TMP_DIR}/release.tar.gz"

CURL_DOWNLOAD_FLAGS=(-fL)
if [[ "${VERBOSE}" != true ]]; then
    CURL_DOWNLOAD_FLAGS+=(-s)
fi

if ! curl "${CURL_DOWNLOAD_FLAGS[@]}" \
        --connect-timeout "${DOWNLOAD_CONNECT_TIMEOUT}" \
        --max-time "${DOWNLOAD_MAX_TIME}" \
        --retry 3 --retry-delay 5 \
        "${TARBALL_URL}" -o "${TARBALL_PATH}"; then
    echo "update.sh: failed to download ${TARBALL_URL} (timed out or errored — see above)" >&2
    exit 1
fi

EXTRACT_DIR="${TMP_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"

vecho "update.sh: extracting..."
tar -xzf "${TARBALL_PATH}" -C "${EXTRACT_DIR}"

EXTRACTED_ROOT="$(find "${EXTRACT_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n1)"

if [[ -z "${EXTRACTED_ROOT}" ]]; then
    echo "update.sh: could not locate extracted release contents — aborting." >&2
    exit 1
fi

if [[ ! -f "${EXTRACTED_ROOT}/${MANIFEST_FILE}" ]]; then
    echo "update.sh: new release has no ${MANIFEST_FILE} — cannot safely determine which files to sync. Aborting." >&2
    exit 1
fi

echo ""
echo "update.sh: checking for files removed in this release..."

REMOVED_FILES=""

if [[ -f "${MANIFEST_FILE}" ]]; then
    REMOVED_FILES="$(comm -23 <(sort "${MANIFEST_FILE}") <(sort "${EXTRACTED_ROOT}/${MANIFEST_FILE}") || true)"
    if [[ -n "${REMOVED_FILES}" ]]; then
        echo "update.sh: the following files existed in your current version but no longer exist upstream:"
        echo "${REMOVED_FILES}" | sed 's/^/  - /'
    else
        echo "update.sh: no files were removed upstream."
    fi
else
    echo "update.sh: no local ${MANIFEST_FILE} found — skipping removed-file detection (nothing to diff against)."
fi

if [[ -n "${REMOVED_FILES}" ]]; then
    echo ""
    echo "update.sh: the files listed above no longer exist in this release."
    read -rp "Delete all of these files locally? [y/N]: " confirm_delete
    if [[ "${confirm_delete}" =~ ^[Yy]$ ]]; then
        while IFS= read -r rel; do
            [[ -z "${rel}" ]] && continue
            if [[ -f "${rel}" ]]; then
                rm -f "${rel}"
                echo "  deleted: ${rel}"
            fi
        done <<< "${REMOVED_FILES}"
    else
        echo "update.sh: keeping removed-upstream files as-is."
    fi
fi

vecho ""
vecho "update.sh: syncing files (config/defaults.json is always fully overwritten; other JSON files are order-preserving deep-merged; everything else is added/overwritten)..."

SYNCED_COUNT=0

while IFS= read -r rel; do
    [[ -z "${rel}" ]] && continue

    if [[ "${rel}" == "${SELF_REL_PATH}" ]]; then
        SRC_SELF="${EXTRACTED_ROOT}/${rel}"
        DEST_SELF="${PROJECT_ROOT}/${rel}"
        if [[ -f "${SRC_SELF}" ]] && ! cmp -s "${SRC_SELF}" "${DEST_SELF}" 2>/dev/null; then
            SELF_TMP="${DEST_SELF}.new.$$"
            cp -f "${SRC_SELF}" "${SELF_TMP}"
            chmod --reference="${DEST_SELF}" "${SELF_TMP}" 2>/dev/null || chmod +x "${SELF_TMP}"
            mv -f "${SELF_TMP}" "${DEST_SELF}"
            vecho "  synced (atomic self-update): ${rel}"
        fi
        SYNCED_COUNT=$((SYNCED_COUNT + 1))
        continue
    fi

    SRC="${EXTRACTED_ROOT}/${rel}"
    DEST="${PROJECT_ROOT}/${rel}"

    if [[ ! -f "${SRC}" ]]; then
        echo "  warning: ${rel} listed in manifest but not found in release archive — skipped"
        continue
    fi

    if [[ "${rel}" == "config/defaults.json" ]]; then
        overwrite_json_file "${rel}"
    elif [[ "${rel}" == *.json ]]; then
        merge_json_file "${rel}"
    else
        mkdir -p "$(dirname "${DEST}")"
        cp -f "${SRC}" "${DEST}"
        vecho "  synced: ${rel}"
    fi

    SYNCED_COUNT=$((SYNCED_COUNT + 1))
done < "${EXTRACTED_ROOT}/${MANIFEST_FILE}"

if [[ "${VERBOSE}" == true ]]; then
    echo "update.sh: synced ${SYNCED_COUNT} file(s)."
else
    echo "updated files"
fi

vecho ""
vecho "update.sh: running final verification..."

VERIFY_OK=1

ON_DISK_VERSION="0.0.0"
if [[ -f "${VERSION_FILE}" ]]; then
    ON_DISK_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
fi

if [[ "${ON_DISK_VERSION}" != "${NEXT_VERSION}" ]]; then
    echo "  warning: ${VERSION_FILE} reads \"${ON_DISK_VERSION}\", expected \"${NEXT_VERSION}\"" >&2
    VERIFY_OK=0
fi

MISSING_COUNT=0
while IFS= read -r rel; do
    [[ -z "${rel}" ]] && continue
    if [[ ! -f "${rel}" ]]; then
        echo "  warning: ${rel} is missing on disk after sync" >&2
        MISSING_COUNT=$((MISSING_COUNT + 1))
    fi
done < "${EXTRACTED_ROOT}/${MANIFEST_FILE}"

if [[ ${MISSING_COUNT} -gt 0 ]]; then
    VERIFY_OK=0
fi

if [[ ${VERIFY_OK} -eq 1 ]]; then
    vecho "update.sh: verification passed — version.txt and all manifest files confirmed on disk."
else
    echo "update.sh: verification found issues (see warnings above) — review before trusting this update." >&2
fi

echo ""
HELPER_SCRIPT="${PROJECT_ROOT}/${HELPERS_DIR}/${NEXT_VERSION}.sh"
if [[ -f "${HELPER_SCRIPT}" ]]; then
    echo "update.sh: running helper script for ${NEXT_VERSION}..."
    chmod +x "${HELPER_SCRIPT}" 2>/dev/null || true
    if bash "${HELPER_SCRIPT}"; then
        echo "update.sh: helper script completed successfully."
    else
        echo "update.sh: WARNING — helper script for ${NEXT_VERSION} exited with a non-zero status." >&2
    fi
else
    echo "update.sh: no helper script for ${NEXT_VERSION} (expected at ${HELPERS_DIR}/${NEXT_VERSION}.sh) — nothing extra to run."
fi

NOTES_FOUND=0
NOTES_DIR="${PROJECT_ROOT}/config/update-notes"

if [[ -d "${NOTES_DIR}" ]]; then
    IN_RANGE_VERSIONS="$(
        find "${NOTES_DIR}" -maxdepth 1 -type f -name '*.md' -exec basename {} .md \; \
        | while IFS= read -r ver; do
            [[ -z "${ver}" ]] && continue
            if in_version_range "${ver}" "${LOCAL_VERSION}" "${NEXT_VERSION}"; then
                printf '%s\n' "${ver}"
            fi
        done | sort -V
    )"

    if [[ -n "${IN_RANGE_VERSIONS}" ]]; then
        while IFS= read -r ver; do
            [[ -z "${ver}" ]] && continue
            notes_rel="config/update-notes/${ver}.md"
            notes_path="${NOTES_DIR}/${ver}.md"
            notes_blob_url="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${NEXT_TAG}/${notes_rel}"

            if [[ -f "${notes_path}" ]]; then
                NOTES_FOUND=$((NOTES_FOUND + 1))
                echo ""
                echo "==================="
                echo "update notes ${ver}"
                echo "==================="
                echo "link: ${notes_blob_url}"
                echo "==================="
                cat "${notes_path}"
                echo "==================="
            fi
        done <<< "${IN_RANGE_VERSIONS}"
    fi
fi

if [[ ${NOTES_FOUND} -eq 0 ]]; then
    echo "update.sh: no update instructions found for version ${NEXT_VERSION}."
else
    echo ""
    echo "update.sh: ${NOTES_FOUND} update note(s) found above — review in order for anything requiring manual steps."
fi

echo ""
echo "update.sh: updated from ${LOCAL_VERSION} to ${NEXT_VERSION}."

if [[ ${REMAINING_AFTER} -gt 0 ]]; then
    echo "update.sh: there are ${REMAINING_AFTER} more version(s) still available. Run this script again to update to the next version."
else
    echo "update.sh: you are now fully up to date."
fi
