#!/usr/bin/env bash
#
# git.sh — everyday git helper for this repo.
#
#   Option 1: Push        — stage everything, commit with a message you type,
#                            then push to origin.
#   Option 2: .gitignore   — type a path (relative to repo root). If it's not
#                            already ignored, it gets added. If it's already
#                            ignored, it gets removed (toggle). Leave the
#                            prompt blank to just print the current
#                            .gitignore. If the path doesn't exist on disk,
#                            the script exits without changing anything.
#
set -euo pipefail

BRANCH="main"

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ ! -d .git ]]; then
    echo "git.sh: no .git repo found in $(pwd)." >&2
    exit 1
fi

echo "canaancope.dev — git helper"
echo "  1) Push changes"
echo "  2) Add/remove a path in .gitignore"
read -rp "Choose an option [1-2]: " choice

case "${choice}" in
    1)
        git add -A

        if git diff --cached --quiet; then
            echo "git.sh: nothing staged to commit — working tree already matches HEAD."
            exit 0
        fi

        read -rp "Commit message: " msg
        if [[ -z "${msg}" ]]; then
            msg="Update $(date '+%Y-%m-%d %H:%M:%S')"
        fi

        git commit -m "${msg}"
        git push origin "${BRANCH}"
        ;;

    2)
        [[ -f .gitignore ]] || touch .gitignore

        read -rp "Path to file/folder (relative to repo root), or leave blank to list .gitignore: " target

        if [[ -z "${target}" ]]; then
            echo "── .gitignore ──"
            cat .gitignore
            exit 0
        fi

        # Strip a trailing slash for existence checks; directories get one
        # re-added below before writing to .gitignore, for clarity.
        clean_target="${target%/}"

        if [[ ! -e "${clean_target}" ]]; then
            echo "git.sh: \"${target}\" does not exist — nothing to add/remove."
            exit 1
        fi

        entry="${clean_target}"
        if [[ -d "${clean_target}" ]]; then
            entry="${clean_target}/"
        fi

        if grep -qxF "${entry}" .gitignore; then
            grep -vxF "${entry}" .gitignore > .gitignore.tmp
            mv .gitignore.tmp .gitignore
            echo "git.sh: removed \"${entry}\" from .gitignore."
        else
            echo "${entry}" >> .gitignore
            echo "git.sh: added \"${entry}\" to .gitignore."
        fi
        ;;

    *)
        echo "git.sh: invalid option." >&2
        exit 1
        ;;
esac
