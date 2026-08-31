#!/usr/bin/env bash
set -euo pipefail

REPO="CanaanJC/CanaanCope.Land"
DEST_DIR="$(pwd)"

echo "installer.sh: installing CanaanCope.Land into ${DEST_DIR}"

for cmd in curl tar; do
    if ! command -v "${cmd}" >/dev/null 2>&1; then
        echo "installer.sh: required command \"${cmd}\" not found — please install it and re-run." >&2
        exit 1
    fi
done

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

TMP_TARBALL="$(mktemp -t canaancope-XXXXXX.tar.gz)"

echo "installer.sh: downloading release tarball..."
curl -fsSL "${TARBALL_URL}" -o "${TMP_TARBALL}"

echo "installer.sh: extracting into ${DEST_DIR}..."
tar -xzf "${TMP_TARBALL}" -C "${DEST_DIR}" --strip-components=1

echo "installer.sh: cleaning up leftover files..."
rm -f "${TMP_TARBALL}"

if [[ -d "${DEST_DIR}/scripts" ]]; then
    chmod +x "${DEST_DIR}/scripts/"*.sh 2>/dev/null || true
fi

echo "installer.sh: done. Files extracted to ${DEST_DIR}"
echo ""
echo "To install and set up run sudo ./scripts/run.sh"
echo ""

exit 0
