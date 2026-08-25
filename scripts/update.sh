#!/usr/bin/env bash
#
# scripts/update.sh — self-updater for this repo.
#
# Run from anywhere; always operates on the project root (one level up from
# this script, i.e. this script must live at scripts/update.sh).
#
# ── What it does, in order ───────────────────────────────────────────────
#   1. Checks dependencies (curl, jq, tar, node) — offers to apt-get install
#      anything missing.
#   2. Reads config/version.txt (defaults to "0.0.0" if missing) WITHOUT
#      downloading the repo, and compares it against the latest GitHub
#      Release's tag using version-aware sort (26.8.1 < 26.8.2 < 26.11.8).
#      If not newer, exits cleanly with nothing touched.
#   3. Shows old → new and asks a single y/N confirmation.
#   4. Runs a real backup (via lib/backup.js's performBackup()), tagged
#      "update from <old> to <new>", wrapped in a hard timeout.
#   5. ACTUALLY VERIFIES the backup exists on disk — re-reads the backup's
#      own manifest.json, finds the entry matching this exact tag, and
#      confirms its folderPath (and a node.js inside it) really exist.
#      If the backup failed, timed out, or can't be verified, the script
#      aborts immediately — nothing else is ever touched.
#   6. Only once the backup is verified: downloads config/manifest.txt from
#      the new release (a flat list of every repo file) and diffs it
#      against the local copy to find files that existed before but were
#      removed upstream.
#   7. Downloads the new release's full tarball and extracts it to a
#      scratch temp dir.
#   8. Prints the full list of files removed upstream (if any) and asks
#      ONE combined y/N prompt before deleting them locally.
#   9. Syncs every file listed in the NEW release's manifest into the
#      project root:
#        - *.json → deep-merged with an ORDER-PRESERVING merge that
#                    mirrors lib/siteConfig.js's deepMerge(): any field,
#                    array, or nested structure that exists in the new
#                    release but is MISSING locally gets added (appended
#                    after your existing fields); anything you already
#                    have on disk is left completely untouched, and the
#                    original order of your existing keys is never
#                    changed.
#        - everything else → added if missing, overwritten if it already
#                    exists (this is also how config/version.txt itself
#                    ends up updated — the version number is never set
#                    explicitly by this script, it's just whatever comes
#                    out of the sync).
#  10. Runs a final verification pass: confirms config/version.txt now
#      reads the target version and that every manifest-listed file
#      actually exists on disk post-sync.
#  11. Prints (never fetches the body of) a clickable link to every
#      config/update-notes/<version>.md that exists upstream for every
#      version between the old and new one (inclusive of the new one),
#      oldest → newest — so skipping several releases never misses notes.
#  12. Cleans up all temp files (via trap, runs even on error/abort) and
#      prints "done".
#
# ── Update source ─────────────────────────────────────────────────────────
# Hardcoded to this project's public GitHub repo. No auth, no env vars,
# no per-machine setup required.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"

GITHUB_OWNER="CanaanJC"
GITHUB_REPO="CanaanCope.Land"

VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"
MASTER_CONFIG_FILE="config/master.json"
TMP_DIR="scripts/.tmp-update"
BACKUP_TIMEOUT_SECS=600 # 10 minutes — hard cap; treated as a failure if exceeded

# ── Dependency checks ──────────────────────────────────────────────────────────

echo "update.sh: checking dependencies..."

REQUIRED_CMDS=(curl jq tar node)
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

# ── jq order-preserving deep-merge function ───────────────────────────────────
#
# Mirrors lib/siteConfig.js's deepMerge() semantics — LOCAL always wins on
# any actual conflict — but goes further than the JS version in one
# specific way this script needs: it preserves the ORIGINAL KEY ORDER of
# the local file exactly as-is, only ever APPENDING genuinely new keys
# (ones that don't exist locally at all) at the end, rather than re-sorting
# or rebuilding the object.
#
# Rules, for every key across both sides:
#   - key exists in local only        → kept as-is (local's value, local's position)
#   - key exists in new only          → appended at the end (new's value)
#   - key exists in both, both objects→ recurse (so nested new fields get
#                                        added without disturbing existing
#                                        sibling keys or their order)
#   - key exists in both, NOT both objects (arrays, scalars, mismatched
#     types) → local's value wins wholesale, untouched
#
# Invoked as: jq -n -f <(this def) --slurpfile local "$dest" --slurpfile new "$src"
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

# Merges a single JSON file: $dest (existing local copy) is the base whose
# key order and existing values are always preserved; $src (the new
# release's copy) only ever contributes fields that are missing locally.
# If $dest doesn't exist yet, or isn't valid JSON, just copies $src
# verbatim instead of attempting a merge. If the merge itself fails for
# some reason, falls back to copying the new file verbatim rather than
# leaving a half-written/corrupt file on disk.
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
            echo "  merged (existing fields/order untouched, new fields added): ${rel}"
        else
            rm -f "${tmp_out}"
            echo "  warning: merge failed for ${rel} — copying new version verbatim instead"
            cp -f "${src}" "${dest}"
        fi
    else
        cp -f "${src}" "${dest}"
        echo "  added: ${rel}"
    fi
}

# ── Version check (no repo download yet — just version.txt via the API) ──────

LOCAL_VERSION="0.0.0"
if [[ -f "${VERSION_FILE}" ]]; then
    LOCAL_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
    [[ -z "${LOCAL_VERSION}" ]] && LOCAL_VERSION="0.0.0"
fi

echo ""
echo "update.sh: local version is ${LOCAL_VERSION}"
echo "update.sh: checking latest release on GitHub (${GITHUB_OWNER}/${GITHUB_REPO})..."

RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest")" || {
    echo "update.sh: failed to reach GitHub API — check your connection." >&2
    exit 1
}

REMOTE_TAG="$(echo "${RELEASE_JSON}" | jq -r '.tag_name // empty')"

if [[ -z "${REMOTE_TAG}" ]]; then
    echo "update.sh: could not determine latest release tag — does this repo have any releases?" >&2
    exit 1
fi

REMOTE_VERSION="${REMOTE_TAG#v}" # strip a leading "v" if the tag uses one

echo "update.sh: latest release tag is \"${REMOTE_TAG}\" (version ${REMOTE_VERSION})"

if [[ "${LOCAL_VERSION}" == "${REMOTE_VERSION}" ]]; then
    echo "update.sh: already up to date (${LOCAL_VERSION})."
    exit 0
fi

HIGHEST="$(printf '%s\n%s\n' "${LOCAL_VERSION}" "${REMOTE_VERSION}" | sort -V | tail -n1)"

if [[ "${HIGHEST}" == "${LOCAL_VERSION}" ]]; then
    echo "update.sh: local version (${LOCAL_VERSION}) is newer than the latest release — nothing to do."
    exit 0
fi

echo ""
echo "update.sh: update available: ${LOCAL_VERSION} → ${REMOTE_VERSION}"
read -rp "Proceed with update? [y/N]: " confirm_update
if [[ ! "${confirm_update}" =~ ^[Yy]$ ]]; then
    echo "update.sh: cancelled — no changes made."
    exit 0
fi

# ── Backup — must genuinely succeed AND be verified on disk before anything else happens ──

echo ""
echo "update.sh: verifying a backup destination is configured..."

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

echo "update.sh: backup destination is \"${BACKUP_PATH_CONFIGURED}\" — running backup now"
echo "update.sh: (hard timeout: ${BACKUP_TIMEOUT_SECS}s — treated as a failure if exceeded)"

BACKUP_TAG="update from ${LOCAL_VERSION} to ${REMOTE_VERSION}"

set +e
timeout "${BACKUP_TIMEOUT_SECS}" node -e "
    const { performBackup } = require('${PROJECT_ROOT}/lib/backup.js');
    performBackup({ force: true, tag: process.argv[1] })
        .then(() => process.exit(0))
        .catch((e) => { console.error(e); process.exit(1); });
" "${BACKUP_TAG}"
BACKUP_EXIT_CODE=$?
set -e

if [[ ${BACKUP_EXIT_CODE} -eq 124 ]]; then
    echo "update.sh: backup TIMED OUT after ${BACKUP_TIMEOUT_SECS}s — aborting update. Nothing has been changed." >&2
    exit 1
elif [[ ${BACKUP_EXIT_CODE} -ne 0 ]]; then
    echo "update.sh: backup process FAILED (exit code ${BACKUP_EXIT_CODE}) — aborting update. Nothing has been changed." >&2
    exit 1
fi

echo "update.sh: backup process reported success — verifying it actually exists on disk..."

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

echo "update.sh: backup verified on disk at ${BACKUP_FOLDER_PATH}"

# ── Scratch dir setup ──────────────────────────────────────────────────────────

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}"
trap 'rm -rf "${TMP_DIR}"' EXIT

# ── Manifest diff — find files removed upstream (computed before any sync) ───

echo ""
echo "update.sh: checking for files removed in the new release..."

NEW_MANIFEST_URL="https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${REMOTE_TAG}/${MANIFEST_FILE}"
NEW_MANIFEST_TMP="${TMP_DIR}/manifest-new.txt"
REMOVED_FILES=""

if curl -fsSL "${NEW_MANIFEST_URL}" -o "${NEW_MANIFEST_TMP}" 2>/dev/null; then
    if [[ -f "${MANIFEST_FILE}" ]]; then
        REMOVED_FILES="$(comm -23 <(sort "${MANIFEST_FILE}") <(sort "${NEW_MANIFEST_TMP}") || true)"
        if [[ -n "${REMOVED_FILES}" ]]; then
            echo "update.sh: the following files existed in your current version but no longer exist upstream:"
            echo "${REMOVED_FILES}" | sed 's/^/  - /'
        else
            echo "update.sh: no files were removed upstream."
        fi
    else
        echo "update.sh: no local ${MANIFEST_FILE} found — skipping removed-file detection (nothing to diff against)."
    fi
else
    echo "update.sh: warning — could not fetch new manifest.txt from the release; skipping removed-file detection."
fi

# ── Download + extract the new release tarball ────────────────────────────────

echo ""
echo "update.sh: downloading release ${REMOTE_TAG}..."

TARBALL_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/${REMOTE_TAG}.tar.gz"
TARBALL_PATH="${TMP_DIR}/release.tar.gz"

if ! curl -fsSL "${TARBALL_URL}" -o "${TARBALL_PATH}"; then
    echo "update.sh: failed to download ${TARBALL_URL}" >&2
    exit 1
fi

EXTRACT_DIR="${TMP_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"

echo "update.sh: extracting..."
tar -xzf "${TARBALL_PATH}" -C "${EXTRACT_DIR}"

# GitHub tarballs contain exactly one top-level folder (e.g. repo-26.8.0/).
EXTRACTED_ROOT="$(find "${EXTRACT_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n1)"

if [[ -z "${EXTRACTED_ROOT}" ]]; then
    echo "update.sh: could not locate extracted release contents — aborting." >&2
    exit 1
fi

if [[ ! -f "${EXTRACTED_ROOT}/${MANIFEST_FILE}" ]]; then
    echo "update.sh: new release has no ${MANIFEST_FILE} — cannot safely determine which files to sync. Aborting." >&2
    exit 1
fi

# ── Deletion — single combined confirmation, then delete if approved ─────────

if [[ -n "${REMOVED_FILES}" ]]; then
    echo ""
    echo "update.sh: the files listed above no longer exist in the new release."
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

# ── Sync every manifest-listed file — merge JSON, add/overwrite everything else ──

echo ""
echo "update.sh: syncing files (JSON files are order-preserving deep-merged; everything else is added/overwritten)..."

SYNCED_COUNT=0

while IFS= read -r rel; do
    [[ -z "${rel}" ]] && continue

    SRC="${EXTRACTED_ROOT}/${rel}"
    DEST="${PROJECT_ROOT}/${rel}"

    if [[ ! -f "${SRC}" ]]; then
        echo "  warning: ${rel} listed in manifest but not found in release archive — skipped"
        continue
    fi

    if [[ "${rel}" == *.json ]]; then
        merge_json_file "${rel}"
    else
        mkdir -p "$(dirname "${DEST}")"
        cp -f "${SRC}" "${DEST}"
        echo "  synced: ${rel}"
    fi

    SYNCED_COUNT=$((SYNCED_COUNT + 1))
done < "${EXTRACTED_ROOT}/${MANIFEST_FILE}"

echo "update.sh: synced ${SYNCED_COUNT} file(s)."

# ── Final verification ────────────────────────────────────────────────────────

echo ""
echo "update.sh: running final verification..."

VERIFY_OK=1

ON_DISK_VERSION="0.0.0"
if [[ -f "${VERSION_FILE}" ]]; then
    ON_DISK_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
fi

if [[ "${ON_DISK_VERSION}" != "${REMOTE_VERSION}" ]]; then
    echo "  warning: ${VERSION_FILE} reads \"${ON_DISK_VERSION}\", expected \"${REMOTE_VERSION}\"" >&2
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
    echo "update.sh: verification passed — version.txt and all manifest files confirmed on disk."
else
    echo "update.sh: verification found issues (see warnings above) — review before trusting this update." >&2
fi

# ── Update notes links — every version between local and target ──────────────
#
# Prints a link for EVERY release's config/update-notes/<version>.md between
# (LOCAL_VERSION, REMOTE_VERSION] that actually has one, oldest → newest, so
# skipping several releases never misses a note. Links only — content is
# never fetched or printed.

echo ""
echo "update.sh: checking for update instructions across all skipped releases..."

is_version_gt() {
    local a="$1" b="$2"
    [[ "${a}" == "${b}" ]] && return 1
    local highest
    highest="$(printf '%s\n%s\n' "${a}" "${b}" | sort -V | tail -n1)"
    [[ "${highest}" == "${a}" ]]
}

is_version_le() {
    local a="$1" b="$2"
    ! is_version_gt "${a}" "${b}"
}

ALL_RELEASES_JSON="$(curl -fsSL "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100" 2>/dev/null || echo "[]")"

RELEASE_PAIRS="$(echo "${ALL_RELEASES_JSON}" | jq -r '.[] | "\(.tag_name)\t\(.tag_name | sub("^v"; ""))"' 2>/dev/null || echo "")"

NOTES_FOUND=0

if [[ -n "${RELEASE_PAIRS}" ]]; then
    IN_RANGE_PAIRS="$(
        while IFS=$'\t' read -r tag ver; do
            [[ -z "${tag}" ]] && continue
            if is_version_gt "${ver}" "${LOCAL_VERSION}" && is_version_le "${ver}" "${REMOTE_VERSION}"; then
                printf '%s\t%s\n' "${tag}" "${ver}"
            fi
        done <<< "${RELEASE_PAIRS}" | sort -t $'\t' -k2 -V
    )"

    if [[ -n "${IN_RANGE_PAIRS}" ]]; then
        while IFS=$'\t' read -r tag ver; do
            [[ -z "${tag}" ]] && continue
            notes_rel="config/update-notes/${ver}.md"
            notes_raw_url="https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${tag}/${notes_rel}"
            notes_blob_url="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/blob/${tag}/${notes_rel}"

            if curl -fsSL --head "${notes_raw_url}" >/dev/null 2>&1; then
                echo "  ${ver}: ${notes_blob_url}"
                NOTES_FOUND=$((NOTES_FOUND + 1))
            fi
        done <<< "${IN_RANGE_PAIRS}"
    fi
fi

if [[ ${NOTES_FOUND} -eq 0 ]]; then
    echo "update.sh: no update instructions found for any version between ${LOCAL_VERSION} and ${REMOTE_VERSION}."
else
    echo "update.sh: ${NOTES_FOUND} update-notes link(s) found above — review in order for anything requiring manual steps."
fi

echo ""
echo "update.sh: done."
