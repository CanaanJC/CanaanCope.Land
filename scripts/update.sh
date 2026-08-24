#!/usr/bin/env bash
#
# scripts/update.sh — self-updater for this repo. Run from anywhere; always
# operates on the project root (one level up from this script).
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
#        - *.json          → deep-merged via a recursive jq function that
#                             mirrors lib/siteConfig.js's deepMerge() exactly:
#                             recurse into matching object keys; if EITHER
#                             side isn't a plain object (this includes
#                             arrays — e.g. config/libraries.json,
#                             public/json/sidebar.json), the LOCAL value
#                             wins wholesale instead of attempting to merge.
#                             This means arrays are never element-merged —
#                             exactly like the JS version — only plain
#                             objects ever get key-by-key recursion.
#        - everything else → copied over as-is (this can never delete
#                             anything on its own — a user's own media/
#                             projects/ entries etc. simply don't exist in
#                             the release tarball, so they're never touched).
#      This naturally also updates config/version.txt and config/manifest.txt
#      to the new release's versions, since both are plain non-JSON files.
#   7. Runs `npm install` to reconcile node_modules/ with any dependency
#      changes merged into package.json/package-lock.json.
#
set -euo pipefail

REPO_OWNER="CanaanJC"
REPO_NAME="CanaanCope.Land"
VERSION_FILE="config/version.txt"
MANIFEST_FILE="config/manifest.txt"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── Dependency checks ─────────────────────────────────────────────────────────

for cmd in curl jq tar node npm; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "update.sh: required command \"${cmd}\" not found on PATH — install it and try again." >&2
        exit 1
    fi
done

# ── jq deep-merge function ────────────────────────────────────────────────────
#
# Mirrors lib/siteConfig.js's deepMerge(base, override) exactly:
#   - If both `base` (new release's value) and `override` (existing local
#     value) are plain objects (not arrays), recurse key-by-key, unioning
#     keys from both sides.
#   - Otherwise (either side is an array, or a scalar, or types differ),
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

echo "update.sh: current version is ${LOCAL ```bash
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
