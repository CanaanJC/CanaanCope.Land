#!/usr/bin/env bash
#
# scripts/update.sh — self-updater for this repo. Run from anywhere; always
# operates on the project root (one level up from this script).
# Run as the same user that owns the project directory (NOT root/sudo —
# this script only touches files inside the project tree plus, at the very
# end, an optional `sudo systemctl restart` if a service was set up via
# run.sh).
#
# ── One-time setup ────────────────────────────────────────────────────────
# Edit GITHUB_OWNER / GITHUB_REPO below (or export them as env vars before
# running) to point at your actual GitHub repo. The script refuses to run
# until these are set to something other than the CHANGE_ME placeholders.
#
# ── What it does, in order ───────────────────────────────────────────────
#   1. Checks dependencies (curl, jq, tar, node, npm) — offers to
#      apt-get install anything missing.
#   2. Reads config/version.txt (local, defaults to "0.0.0" if missing) and
#      compares it against the latest GitHub Release's tag name, using
#      version-aware sort (26.8.0 < 26.8.2 < 27.11.0). If not newer, exits
#      cleanly with nothing touched.
#   3. If newer, shows old → new and asks to confirm.
#   4. Verifies config/master.json's backup.path is actually configured —
#      if it's empty, aborts immediately with an error (an "unconfigured"
#      backup is treated as a failed backup, never as a silent no-op skip,
#      since this script's entire safety model depends on a real backup
#      having happened first).
#   5. Runs the backup via the same lib/backup.js performBackup() the
#      terminal/scheduler use, tagged with the version bump, wrapped in a
#      hard timeout. If it fails, times out, or never responds, the script
#      exits immediately with that error — nothing else on disk is ever
#      touched unless the backup genuinely, provably succeeded.
#   6. Downloads the new release's config/manifest.txt and diffs it against
#      the current local config/manifest.txt (if one exists) to find files
#      that existed before but were removed upstream. Your own project
#      content (media/, extra library entries, etc.) is never listed in
#      either manifest, so it's never a candidate here.
#   7. Downloads the new release's full tarball, extracts it to a temp dir.
#   8. Syncs every file listed in the NEW manifest into the project root:
#        - *.json   → deep-merged via a recursive jq function that mirrors
#                     lib/siteConfig.js's deepMerge() exactly: recurse into
#                     matching object keys on both sides; whenever either
#                     side isn't a plain object (this includes arrays), the
#                     LOCAL (your existing) value wins wholesale for that
#                     key. Net effect: any brand-new key/section the new
#                     release introduces gets added automatically, while
#                     every value you already have — including entire
#                     arrays — is always preserved untouched. Works for any
#                     JSON file in the manifest, not just config/master.json,
#                     and requires no per-file special-casing.
#        - everything else → copied over as-is (can never delete anything
#                     on its own — files not in the manifest simply aren't
#                     touched).
#   9. Prompts to delete the files identified as removed-upstream in step 6
#      (skipped entirely if there were none).
#  10. Writes the new version into config/version.txt.
#  11. Runs npm install (in case package.json/package-lock.json changed).
#  12. If scripts/.service-name exists (i.e. run.sh set up a systemd
#      service), offers to restart it now via sudo.
#  13. Prints a browser link to config/update-notes/<version>.md from the
#      release if that file exists upstream (e.g. 26.8.0.md), otherwise
#      prints "No update instructions for this update."
#  14. Cleans up all temp files (via trap, runs even on error/abort).
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROJECT_ROOT="$(pwd)"

# ── One-time setup — EDIT THESE ───────────────────────────────────────────────

GITHUB_OWNER="${GITHUB_OWNER:-CHANGE_ME}"
GITHUB_REPO="${GITHUB_REPO:-CHANGE_ME}"

if [[ "${GITHUB_OWNER}" == "CHANGE_ME" || "${GITHUB_REPO}" == "CHANGE_ME" ]]; then
    echo "update.sh: GITHUB_OWNER/GITHUB_REPO are not configured." >&2
    echo "           edit the top of scripts/update.sh (or export GITHUB_OWNER=... GITHUB_REPO=..." >&2
    echo "           before running) to point at your actual GitHub repository." >&2
    exit 1
fi

VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"
MASTER_CONFIG_FILE="config/master.json"
SERVICE_NAME_FILE="scripts/.service-name"
TMP_DIR="scripts/.tmp-update"
BACKUP_TIMEOUT_SECS=600 # 10 minutes — hard cap; treated as a failure if exceeded

# ── Dependency checks ──────────────────────────────────────────────────────────

echo "update.sh: checking dependencies..."

REQUIRED_CMDS=(curl jq tar node npm)
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

# ── jq deep-merge function ────────────────────────────────────────────────────
#
# Mirrors lib/siteConfig.js's deepMerge(base, override) exactly:
#   - If both `base` (new release's value) and `override` (existing local
#     value) are plain objects (not arrays), recurse key-by-key, unioning
#     keys from both sides — any key only present on one side is kept as-is.
#   - Otherwise (either side is an array, a scalar, or types differ),
#     `override` (the LOCAL value) wins wholesale — the new release's value
#     is discarded entirely for that key/subtree.
#
# Invoked as: jq -n -f <(this def) --slurpfile new "$src" --slurpfile local "$dest"
# with $new[0] = the new release's JSON, $local[0] = the existing local JSON.
JQ_DEEPMERGE='
def is_plain_object:
    type == "object";

def deepmerge(base; override):
    if (base | is_plain_object) and (override | is_plain_object) then
        reduce ((base | keys_unsorted) + (override | keys_unsorted) | unique[]) as $key
            ({};
             .[$key] = (
                if (base | has($key)) and (override | has($key)) then
                    deepmerge(base[$key]; override[$key])
                elif (override | has($key)) then
                    override[$key]
                else
                    base[$key]
                end
             )
            )
    else
        override
    end;

deepmerge($new[0]; $local[0])
'

# Merges a single JSON file: new release's copy is $src (base), existing
# local copy at $dest is override (always wins on conflicts). If $dest
# doesn't exist yet, or isn't valid JSON, just copies $src verbatim instead
# of attempting a merge — nothing to preserve either way. If the merge
# itself fails for some reason, falls back to copying the new file verbatim
# rather than leaving a half-written/corrupt file on disk.
merge_json_file() {
    local rel="$1"
    local src="${EXTRACTED_ROOT}/${rel}"
    local dest="${PROJECT_ROOT}/${rel}"

    mkdir -p "$(dirname "${dest}")"

    if [[ -f "${dest}" ]] && jq empty "${dest}" >/dev/null 2>&1; then
        local tmp_out
        tmp_out="$(mktemp)"
        if jq -n -f <(printf '%s' "${JQ_DEEPMERGE}") --slurpfile new "${src}" --slurpfile local "${dest}" > "${tmp_out}" 2>/dev/null; then
            mv "${tmp_out}" "${dest}"
            echo "  merged: ${rel}"
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

# ── Version check ──────────────────────────────────────────────────────────────

LOCAL_VERSION="0.0.0"
if [[ -f "${VERSION_FILE}" ]]; then
    LOCAL_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"
    [[ -z "${LOCAL_VERSION}" ]] && LOCAL_VERSION="0.0.0"
fi

echo ""
echo "update.sh: local version is ${LOCAL_VERSION}"
echo "update.sh: checking latest release on GitHub (${GITHUB_OWNER}/${GITHUB_REPO})..."

RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest")" || {
    echo "update.sh: failed to reach GitHub API — check your connection/repo name." >&2
    exit 1
}

REMOTE_TAG="$(echo "${RELEASE_JSON}" | jq -r '.tag_name // empty')"

if [[ -z "${REMOTE_TAG}" ]]; then
    echo "update.sh: could not determine latest release tag — does this repo have any releases?" >&2
    exit 1
fi

REMOTE_VERSION="${REMOTE_TAG#v}" # strip a leading "v" if the tag uses one (v26.8.0 -> 26.8.0)

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

# ── Backup — must genuinely succeed or the script aborts entirely ────────────

echo ""
echo "update.sh: verifying a backup destination is configured..."

if [[ ! -f "${MASTER_CONFIG_FILE}" ]]; then
    echo "update.sh: ${MASTER_CONFIG_FILE} not found — cannot verify backup configuration. Aborting." >&2
    exit 1
fi

BACKUP_PATH_CONFIGURED="$(jq -r '.backup.path // ""' "${MASTER_CONFIG_FILE}" 2>/dev/null || echo "")"

if [[ -z "${BACKUP_PATH_CONFIGURED}" ]]; then
    echo "update.sh: backup.path is not configured in ${MASTER_CONFIG_FILE}." >&2
    echo "           this script refuses to update without a real backup — set backup.path" >&2
    echo "           (via the Admin panel or directly in the config) and try again." >&2
    exit 1
fi

echo "update.sh: backup destination is \"${BACKUP_PATH_CONFIGURED}\" — running backup now"
echo "update.sh: (hard timeout: ${BACKUP_TIMEOUT_SECS}s — treated as a failure if exceeded)"

BACKUP_TAG="updating version from ${LOCAL_VERSION} to ${REMOTE_VERSION}"

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
    echo "update.sh: backup TIMED OUT after ${BACKUP_TIMEOUT_SECS}s (never responded/completed) — aborting update. Nothing has been changed." >&2
    exit 1
elif [[ ${BACKUP_EXIT_CODE} -ne 0 ]]; then
    echo "update.sh: backup FAILED (exit code ${BACKUP_EXIT_CODE}) — aborting update. Nothing has been changed." >&2
    exit 1
fi

echo "update.sh: backup complete and verified."

# ── Scratch dir setup ──────────────────────────────────────────────────────────

rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}"
trap 'rm -rf "${TMP_DIR}"' EXIT

# ── Manifest diff — find files removed upstream (computed BEFORE any sync) ───

echo ""
echo "update.sh: checking for files removed in the new release..."

NEW_MANIFEST_URL="https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${REMOTE_TAG}/${MANIFEST_FILE}"
NEW_MANIFEST_TMP="${TMP_DIR}/manifest-new.txt"
REMOVED_FILES=""

if curl -fsSL "${NEW_MANIFEST_URL}" -o "${NEW_MANIFEST_TMP}" 2>/dev/null; then
    if [[ -f "${MANIFEST_FILE}" ]]; then
        REMOVED_FILES="$(comm -23 <(sort "${MANIFEST_FILE}") <(sort "${NEW_MANIFEST_TMP}") || true)"
        if [[ -n "${REMOVED_FILES}" ]]; then
            echo "update.sh: the following files existed in your current release but no longer exist upstream:"
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

# ── Sync every manifest-listed file — merge JSON, overwrite/create everything else ──

echo ""
echo "update.sh: syncing files (JSON files are deep-merged; everything else is overwritten/created)..."

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
    fi

    SYNCED_COUNT=$((SYNCED_COUNT + 1))
done < "${EXTRACTED_ROOT}/${MANIFEST_FILE}"

echo "update.sh: synced ${SYNCED_COUNT} file(s)."

# ── Delete files removed upstream (prompted once, after sync) ────────────────

if [[ -n "${REMOVED_FILES}" ]]; then
    echo ""
    read -rp "Delete the files removed upstream (listed above) locally too? [y/N]: " confirm_delete
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

# ── Write new version (belt-and-suspenders — should already match post-sync) ──

echo "${REMOTE_VERSION}" > "${VERSION_FILE}"
echo "update.sh: config/version.txt confirmed at ${REMOTE_VERSION}."

# ── npm install (in case dependencies changed) ────────────────────────────────

if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
    echo ""
    echo "update.sh: running npm install to reconcile any dependency changes..."
    ( cd "${PROJECT_ROOT}" && npm install )
    echo "update.sh: npm install complete."
fi

# ── Restart the service, if one exists ────────────────────────────────────────

if [[ -f "${SERVICE_NAME_FILE}" ]]; then
    SERVICE_NAME="$(tr -d '[:space:]' < "${SERVICE_NAME_FILE}")"
    if [[ -n "${SERVICE_NAME}" ]]; then
        echo ""
        read -rp "Restart the \"${SERVICE_NAME}\" service now to apply the update? [y/N]: " confirm_restart
        if [[ "${confirm_restart}" =~ ^[Yy]$ ]]; then
            sudo systemctl restart "${SERVICE_NAME}"
            echo "update.sh: \"${SERVICE_NAME}\" restarted."
        else
            echo "update.sh: skipping restart — run 'sudo ./scripts/service.sh' (option 4) whenever you're ready."
        fi
    fi
fi

# ── Update notes links — every version between local and target ──────────────
#
# If the user skipped several releases, print a link for EVERY release's
# config/update-notes/<version>.md between (LOCAL_VERSION, REMOTE_VERSION]
# that actually has one — not just the final target version — so nothing
# gets missed. Printed oldest → newest, matching the order changes would
# have been applied in.

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

# tag<TAB>version pairs, one per line (version has any leading "v" stripped)
RELEASE_PAIRS="$(echo "${ALL_RELEASES_JSON}" | jq -r '.[] | "\(.tag_name)\t\(.tag_name | sub("^v"; ""))"' 2>/dev/null || echo "")"

NOTES_FOUND=0

if [[ -n "${RELEASE_PAIRS}" ]]; then
    # Filter to (LOCAL_VERSION, REMOTE_VERSION], then sort ascending by version
    # (field 2) so notes print in the order the updates would have applied.
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
    echo "update.sh: ${NOTES_FOUND} update-notes file(s) found above — review in order for anything requiring manual steps."
fi

echo ""
echo "update.sh: update to ${REMOTE_VERSION} complete."
