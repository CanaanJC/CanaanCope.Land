#!/usr/bin/env bash
#
# installer.sh — bootstrap installer for CanaanCope.Land
#
# Usage:
#   curl -fsSL https://canaancope.land/installer.sh | bash
#
# What it does:
#   1. Downloads the latest GitHub release tarball into the current directory.
#   2. Extracts it (stripping the wrapper folder) and cleans up leftover files.
#   3. Asks whether you want to start the server now.
#      - yes -> runs `sudo ./scripts/run.sh` automatically
#      - no  -> prints the command to run later
#
set -euo pipefail

REPO="CanaanJC/CanaanCope.Land"
DEST_DIR="$(pwd)"

echo "installer.sh: installing CanaanCope.Land into ${DEST_DIR}"

# ── Dependency sanity check ──────────────────────────────────────────────────
for cmd in curl tar; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "installer.sh: required command \"${cmd}\" not found — please install it and re-run." >&2
        exit 1
    fi
done

# ── Resolve latest release tarball URL ───────────────────────────────────────
echo "installer.sh: looking up latest release..."

API_RESPONSE="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"

if command -v jq >/dev/null 2>&1; then
    TARBALL_URL="$(echo "${API_RESPONSE}" | jq -r '.tarball_url // empty')"
    TAG_NAME="$(echo "${API_RESPONSE}" | jq -r '.tag_name // empty')"
else
    TARBALL_URL="$(echo "${API_RESPONSE}" | grep '"tarball_url"' | head -n1 | cut -d '"' -f 4)"
    TAG_NAME="$(echo "${API_RESPONSE}" | grep '"tag_name"' | head -n1 | cut -d '"' -f 4)"
fi

if [[ -z "${TARBALL_URL}" || "${TARBALL_URL}" == "null" ]]; then
    echo "installer.sh: could not find a published release for ${REPO} — aborting." >&2
    exit 1
fi

echo "installer.sh: latest release is ${TAG_NAME:-unknown}"

# ── Download + extract ───────────────────────────────────────────────────────
TMP_TARBALL="$(mktemp -t canaancope-XXXXXX.tar.gz)"

echo "installer.sh: downloading release tarball..."
curl -fsSL "${TARBALL_URL}" -o "${TMP_TARBALL}"

echo "installer.sh: extracting into ${DEST_DIR}..."
tar -xzf "${TMP_TARBALL}" -C "${DEST_DIR}" --strip-components=1

echo "installer.sh: cleaning up leftover files..."
rm -f "${TMP_TARBALL}"

echo "installer.sh: done. Files extracted to ${DEST_DIR}"

# ── Ask whether to start the server ──────────────────────────────────────────
#
# Note: this script may be run via `curl | bash`, in which case stdin is the
# piped script itself, not the terminal. Read the prompt from /dev/tty
# directly so the question still works interactively in that case.

echo ""
if [[ -r /dev/tty ]]; then
    read -rp "Do you want to start the server now? [y/N]: " START_NOW < /dev/tty
else
    START_NOW="n"
fi

if [[ "${START_NOW}" =~ ^[Yy]$ ]]; then
    echo "installer.sh: starting the server now (sudo ./scripts/run.sh)..."
    cd "${DEST_DIR}/scripts"
    sudo ./run.sh
else
    echo "installer.sh: not starting now."
    echo ""
    echo "When you're ready to start the server, run:"
    echo ""
    echo "    sudo ./scripts/run.sh"
    echo ""
fi
