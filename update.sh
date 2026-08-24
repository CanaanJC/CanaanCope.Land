#!/usr/bin/env bash
#
# update.sh — self-updater for this repo, run from the project root (./).
#
# What it does, in order:
#   1. Reads config/version.txt (local) and compares it against the latest
#      GitHub Release's config/version.txt (remote), using version-aware
#      sort (26.8.0 < 26.8.2 < 27.11.0).
#   2. If a newer version is available, asks for confirmation.
#   3. On confirm: runs a backup first (tagged "updating version from X to Y"),
#      via the same lib/backup.js performBackup() the terminal/scheduler use.
#   4. Downloads the new release's tarball, extracts it to a temp dir.
#   5. Diffs the OLD local config/manifest.txt against the NEW remote
#      config/manifest.txt to find files that were removed upstream between
#      the two versions — lists them and asks once whether to delete them
#      locally too (files the user added themselves, e.g. their own
#      projects/media, were never in either manifest, so they're never
#      touched by this step).
#   6. Overlays every file from the new release onto disk:
#        - *.json          → deep-merged (existing local values always win;
#                             only NEW keys from the release get added) —
#                             mirrors lib/siteConfig.js's deepMerge logic,
#                             just done here generically via jq.
#        - everything else → copied over as-is (this can never delete
#                             anything on its own — a user's own media/
#                             projects/ entries etc. simply don't exist in
#                             the release tarball, so they're never touched).
#   7. Writes the new version into config/version.txt (this happens
#      naturally as part of step 6's overlay, since version.txt is a plain
#      non-JSON file — but called out explicitly here for clarity).
#   8. Prints a reminder to run `npm install` (package.json/package-lock.json
#      go through the same JSON-merge rule as everything else, so a bumped
#      dependency version won't itself install new packages — merging just
#      updates the files, npm install reconciles node_modules/).
#
set -euo pipefail

REPO_OWNER="CanaanJC"
REPO_NAME="CanaanCope.Land"
VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"

cd "$(dirname "${BASH_SOURCE[0]}")"

# ── Dependency checks ─────────────────────────────────────────────────────────

for cmd in curl jq tar; do
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

if [[ "${HIGHEST_VERSION}" == "${LOCAL_VERSION}" ]]; then
    echo "update.sh: already up to date (local ${LOCAL_VERSION} >= remote ${REMOTE_VERSION})."
    exit 0
fi

echo ""
echo "Update available: ${LOCAL_VERSION} → ${REMOTE_VERSION}"
read -rp "Download and install this update? [y/N]: " confirm_update
if [[ ! "${confirm_update}" =~ ^[Yy]$ ]]; then
    echo "update.sh: update cancelled."
    exit 0
fi

# ── Step 1: backup first, tagged with the version transition ────────────────

echo ""
echo "update.sh: running a backup before updating..."

BACKUP_TAG="updating version from ${LOCAL_VERSION} to ${REMOTE_VERSION}" \
    node -e "
        const { performBackup } = require('./lib/backup');
        performBackup({ force: true, tag: process.env.BACKUP_TAG })
            .then(() => process.exit(0))
            .catch((e) => { console.error('[backup] error:', e.message); process.exit(1); });
    " || {
        echo "update.sh: backup failed — aborting update (nothing has been changed)." >&2
        exit 1
    }

echo "update.sh: backup complete."

# ── Step 2: figure out which files were removed upstream, using the OLD local
#    manifest (before it gets overwritten) vs. the NEW remote manifest ──────

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

# Files present in the OLD manifest but NOT in the NEW manifest = removed
# upstream between these two versions. `comm -23` needs both inputs sorted
# (git.sh already writes manifest.txt pre-sorted, but sort again defensively
# in case of manual edits).
REMOV 
