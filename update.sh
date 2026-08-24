#!/usr/bin/env bash
#
# update.sh — self-updater for this repo, run from the project root (./).
# Run as a user with write access to the project directory AND to
# config/backup.path's target (needed for the pre-update backup step).
#
# What it does, in order:
#   1. Reads config/version.txt (local) and compares it against the latest
#      GitHub Release's config/version.txt (remote), using version-aware
#      sort (26.8.0 < 26.8.2 < 27.11.0).
#   2. If a newer version is available, asks for confirmation.
#   3. On confirm: runs a backup FIRST (tagged "updating version from X to Y"),
#      via the same lib/backup.js performBackup() the terminal/scheduler use.
#      If the backup fails for any reason, the script aborts immediately —
#      nothing on disk is touched by the update itself unless the backup
#      genuinely succeeded.
#   4. Diffs the OLD local config/manifest.txt (captured before anything is
#      overwritten) against the NEW remote config/manifest.txt (fetched
#      directly — no tarball download needed just for this) to find files
#      that were removed upstream between the two versions — lists them and
#      asks once whether to delete them locally too. Files the user added
#      themselves (their own projects/, media/, etc.) were never in either
#      manifest, so they're never touched by this step.
#   5. Downloads the new release's tarball, extracts it to a temp dir.
#   6. Overlays every file from the new release onto disk:
#        - *.json          → deep-merged (existing local values always win;
#                             only NEW keys from the release get added) —
#                             mirrors lib/siteConfig.js's deepMerge logic,
#                             done here generically via jq.
#        - everything else → copied over as-is (this can never delete
#                             anything on its own — a user's own media/
#                             projects/ entries etc. simply don't exist in
#                             the release tarball, so they're never touched).
#      This naturally also updates config/version.txt and config/manifest.txt
#      to the new release's versions, since both are plain non-JSON files.
#   7. Prints a reminder to run `npm install` (package.json/package-lock.json
#      go through the same JSON-merge rule as everything else, so a bumped
#      dependency version won't itself install new packages — merging just
#      updates the files on disk; npm install reconciles node_modules/).
#
set -euo pipefail

REPO_OWNER="CanaanJC"
REPO_NAME="CanaanCope.Land"
VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"

cd "$(dirname "${BASH_SOURCE[0]}")"

# ── Dependency checks ─────────────────────────────────────────────────────────

for cmd in curl jq tar node; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "update.sh: required command \"${cmd}\" not found on PATH — install it and try again." >&2
        exit 1
    fi
done

# ── Read local version ────────────────────────────────────────────────────────

if [[ ! -f "${VERSION_FILE}" ]]; then
    echo "update.sh: ${VERSION_FILE} not found — cannot determine current version." >&2
    exit 1
fi

LOCAL_VERSION="$(tr -d '[:space:]' < "${VERSION_FILE}")"

if [[ -z "${LOCAL_VERSION}" ]]; then
    echo "update.sh: ${VERSION_FILE} is empty — cannot determine current version." >&2
    exit 1
fi

echo "update.sh: current version is ${LOCAL_VERSION}"

# ── Look up the latest release tag ────────────────────────────────────────────

echo "update.sh: checking for the latest release..."

LATEST_RELEASE_JSON="$(curl -sf "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest")" || {
    echo "update.sh: failed to reach the GitHub API — check your internet connection." >&2
    exit 1
}

REMOTE_TAG="$(echo "${LATEST_RELEASE_JSON}" | jq -r '.tag_name // empty')"

if [[ -z "${REMOTE_TAG}" ]]; then
    echo "update.sh: could not determine the latest release tag from the GitHub API response:" >&2
    echo "${LATEST_RELEASE_JSON}" >&2
    exit 1
fi

echo "update.sh: latest release tag is ${REMOTE_TAG}"

# ── Fetch the remote version.txt at that tag (source of truth, not just the
#    tag name itself, in case they ever drift) ────────────────────────────────

REMOTE_VERSION="$(curl -sf "https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REMOTE_TAG}/${VERSION_FILE}" | tr -d '[:space:]')" || {
    echo "update.sh: failed to fetch ${VERSION_FILE} from tag ${REMOTE_TAG}." >&2
    exit 1
}

if [[ -z "${REMOTE_VERSION}" ]]; then
    echo "update.sh: fetched an empty remote version — aborting." >&2
    exit 1
fi

echo "update.sh: latest release version is ${REMOTE_VERSION}"

# ── Compare versions (version-aware sort — 26.8.0 < 26.8.2 < 27.11.0) ────────

HIGHEST_VERSION="$(printf '%s\n%s\n' "${LOCAL_VERSION}" "${REMOTE_VERSION}" | sort -V | tail -n1)"

if [[ "${HIGHEST_VERSION}" == "${LOCAL_VERSION}" && "${LOCAL_VERSION}" != "${REMOTE_VERSION}" ]]; then
    echo "update.sh: local version (${LOCAL_VERSION}) is newer than or equal to the latest release (${REMOTE_VERSION}) — nothing to do."
    exit 0
fi

if [[ "${LOCAL_VERSION}" == "${REMOTE_VERSION}" ]]; then
    echo "update.sh: already up to date (${LOCAL_VERSION})."
    exit 0
fi

echo ""
echo "Update available: ${LOCAL_VERSION} → ${REMOTE_VERSION}"
read -rp "Download and install this update? [y/N]: " confirm_update
if [[ ! "${confirm_update}" =~ ^[Yy]$ ]]; then
    echo "update.sh: update cancelled."
    exit 0
fi

# ── Step 1: backup first, tagged with the version transition. Aborts the
#    whole update immediately if the backup fails for any reason. ──────────

echo ""
echo "update.sh: running a backup before updating..."

BACKUP_TAG="updating version from ${LOCAL_VERSION} to ${REMOTE_VERSION}" \
    node -e "
        const { performBackup } = require('./lib/backup');
        performBackup({ force: true, tag: process.env.BACKUP_TAG })
            .then(() => process.exit(0))
            .catch((e) => { console.error('[backup] error:', e.message); process.exit(1); });
    " || {
        echo "update.sh: backup failed — aborting update. Nothing has been changed." >&2
        exit 1
    }

echo "update.sh: backup complete — proceeding with update."

# ── Step 2: figure out which files were removed upstream, using the OLD local
#    manifest (captured now, before anything is overwritten) vs. the NEW
#    remote manifest fetched directly (no tarball download needed for this) ──

echo ""
echo "update.sh: checking for files removed upstream..."

if [[ -f "${MANIFEST_FILE}" ]]; then
    OLD_MANIFEST_CONTENT="$(cat "${MANIFEST_FILE}")"
else
    echo "update.sh: warning — no local ${MANIFEST_FILE} found; skipping removed-file detection."
    OLD_MANIFEST_CONTENT=""
fi

NEW_MANIFEST_CONTENT="$(curl -sf "https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REMOTE_TAG}/${MANIFEST_FILE}")" || {
    echo "update.sh: failed to fetch the new release's ${MANIFEST_FILE} — aborting." >&2
    exit 1
}

REMOVED_FILES=""
if [[ -n "${OLD_MANIFEST_CONTENT}" ]]; then
    # Files present in the OLD manifest but NOT in the NEW manifest = removed
    # upstream between these two versions. comm -23 needs both inputs sorted
    # (git.sh already writes manifest.txt pre-sorted, but sort again
    # defensively in case of manual edits).
    REMOVED_FILES="$(comm -23 \
        <(printf '%s\n' "${OLD_MANIFEST_CONTENT}" | sort) \
        <(printf '%s\n' "${NEW_MANIFEST_CONTENT}" | sort) \
    )"
fi

DELETE_CONFIRMED=false
if [[ -n "${REMOVED_FILES}" ]]; then
    echo ""
    echo "The following files were removed upstream between ${LOCAL_VERSION} and ${REMOTE_VERSION}:"
    echo "${REMOVED_FILES}" | sed 's/^/  - /'
    echo ""
    read -rp "Delete these files locally too? [y/N]: " confirm_delete
    if [[ "${confirm_delete}" =~ ^[Yy]$ ]]; then
        DELETE_CONFIRMED=true
    else
        echo "update.sh: keeping these files locally (they will not be touched)."
    fi
else
    echo "update.sh: no files were removed upstream."
fi

# ── Step 3: download and extract the new release's tarball ──────────────────

echo ""
echo "update.sh: downloading release ${REMOTE_TAG}..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

TARBALL_PATH="${TMP_DIR}/release.tar.gz"

curl -sfL -o "${TARBALL_PATH}" "https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/tags/${REMOTE_TAG}" || {
    echo "update.sh: failed to download the release tarball." >&2
    exit 1
}

EXTRACT_DIR="${TMP_DIR}/extracted"
mkdir -p "${EXTRACT_DIR}"

# GitHub's tarball wraps everything in a single top-level folder
# (e.g. CanaanCope.Land-26.8.1/) — strip it so paths line up with the repo root.
tar -xzf "${TARBALL_PATH}" -C "${EXTRACT_DIR}" --strip-components=1

echo "update.sh: extracted to ${EXTRACT_DIR}"

# ── Step 4: overlay files onto disk ──────────────────────────────────────────
#
# JSON files: deep-merge via jq — existing local values always win; only
# keys present in the new release but MISSING locally get added. This is
# the same rule as lib/siteConfig.js's deepMerge(defaults, master), just
# applied generically here to every JSON file in the tree via jq's recursive
# merge operator (`*`), which — like deepMerge — recurses into nested
# objects but treats arrays/scalars as atomic (the new value only applies
# if the key doesn't already exist on the local side; jq's `*` on its own
# would let the RIGHT side win on conflicts, so we merge new-then-local,
# i.e. `NEW * LOCAL`, so LOCAL's existing values always take precedence).
#
# Everything else: copied over as-is, overwriting whatever's there. This can
# never delete anything on its own — files that only exist locally (a user's
# own public/projects/<their-entry>/, media/, etc.) simply aren't present in
# the release tree at all, so they're untouched by this step.

echo ""
echo "update.sh: installing update..."

INSTALLED_COUNT=0
MERGED_COUNT=0

while IFS= read -r -d '' src_file; do
    rel_path="${src_file#${EXTRACT_DIR}/}"
    dest_file="${rel_path}"

    mkdir -p "$(dirname "${dest_file}")"

    if [[ "${dest_file}" == *.json ]]; then
        if [[ -f "${dest_file}" ]]; then
            # Both sides are JSON objects/arrays — merge with LOCAL winning
            # on any key that exists on both sides.
            if jq -s '.[0] * .[1]' "${src_file}" "${dest_file}" > "${dest_file}.update-tmp" 2>/dev/null; then
                mv "${dest_file}.update-tmp" "${dest_file}"
                MERGED_COUNT=$((MERGED_COUNT + 1))
            else
                echo "update.sh: warning — failed to merge ${dest_file} as JSON (invalid JSON on one side?); leaving it untouched." >&2
                rm -f "${dest_file}.update-tmp"
            fi
        else
            cp "${src_file}" "${dest_file}"
            INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
        fi
    else
        cp "${src_file}" "${dest_file}"
        INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
    fi
done < <(find "${EXTRACT_DIR}" -type f -print0)

echo "update.sh: installed ${INSTALLED_COUNT} file(s), merged ${MERGED_COUNT} JSON file(s)."

# ── Step 5: apply confirmed deletions ────────────────────────────────────────

if [[ "${DELETE_CONFIRMED}" == true ]]; then
    echo ""
    echo "update.sh: deleting files removed upstream..."
    while IFS= read -r removed_file; do
        [[ -z "${removed_file}" ]] && continue
        if [[ -f "${removed_file}" ]]; then
            rm -f "${removed_file}"
            echo "  deleted: ${removed_file}"
        fi
    done <<< "${REMOVED_FILES}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "update.sh: update to ${REMOTE_VERSION} complete."
echo "update.sh: run \`npm install\` now to reconcile any dependency changes in package.json."
