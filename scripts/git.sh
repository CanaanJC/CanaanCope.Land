#!/usr/bin/env bash
set -euo pipefail

BRANCH="main"
MANIFEST_PATH="config/manifest.txt"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${EUID}" -eq 0 ]]; then
    echo "git.sh: this script must NOT be run with sudo/as root." >&2
    echo "        git commits/pushes and .gitignore edits need to run as your" >&2
    echo "        normal user account (SSH keys, git identity, file ownership" >&2
    echo "        all live there, not root's)." >&2
    echo "        run it as: ./scripts/git.sh" >&2
    exit 1
fi

if [[ ! -d .git ]]; then
    echo "git.sh: no .git repo found in $(pwd)." >&2
    exit 1
fi

untrack_ignored_files() {
    local ignored_tracked
    ignored_tracked="$(git ls-files -ci --exclude-standard)"

    if [[ -n "${ignored_tracked}" ]]; then
        echo "git.sh: found tracked files that are now .gitignore'd — untracking them:"
        echo "${ignored_tracked}" | sed 's/^/  - /'
        echo "${ignored_tracked}" | git rm -r --cached --quiet --pathspec-from-file=- 2>/dev/null || \
            echo "${ignored_tracked}" | xargs -d '\n' git rm -r --cached --quiet --
    fi
}

regenerate_manifest() {
    mkdir -p "$(dirname "${MANIFEST_PATH}")"
    git ls-files | sort > "${MANIFEST_PATH}"
    git add "${MANIFEST_PATH}"
}

handle_push_rejection() {
    echo
    echo "git.sh: push was rejected — the remote has commits you don't have" >&2
    echo "        locally (e.g. a file was edited on the GitHub web UI)." >&2
    echo
    read -rp "Abort and keep remote as-is, or override remote with your local history? [A(bort)/o(verride)] (default: abort): " resolution

    case "${resolution}" in
        [Oo]|[Oo][Vv][Ee][Rr][Rr][Ii][Dd][Ee])
            echo "git.sh: force-pushing local history over remote — remote-only changes will be lost."
            git push --force origin "${BRANCH}"
            ;;
        *)
            echo "git.sh: aborted. Your commit is still saved locally — it just wasn't pushed." >&2
            echo "        Remote is untouched. Re-run this script and choose to override once" >&2
            echo "        you're ready, or resolve manually with 'git pull'." >&2
            exit 1
            ;;
    esac
}

echo "canaancope.dev — git helper"
echo "  1) Push changes"
echo "  2) Add/remove a path in .gitignore"
read -rp "Choose an option [1-2]: " choice

case "${choice}" in
    1)
        untrack_ignored_files
        git add -A
        regenerate_manifest

        if git diff --cached --quiet; then
            echo "git.sh: nothing staged to commit — working tree already matches HEAD."
            exit 0
        fi

        read -rp "Commit message: " msg
        if [[ -z "${msg}" ]]; then
            msg="Update $(date '+%Y-%m-%d %H:%M:%S')"
        fi

        git commit -m "${msg}"

        if ! git push origin "${BRANCH}"; then
            handle_push_rejection
        fi
        ;;

    2)
        [[ -f .gitignore ]] || touch .gitignore

        read -rp "Path to file/folder (relative to repo root), or leave blank to list .gitignore: " target

        if [[ -z "${target}" ]]; then
            echo "── .gitignore ──"
            cat .gitignore
            exit 0
        fi

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
            echo "git.sh: note — if \"${entry}\" was already tracked by git, it will be"
            echo "        automatically untracked the next time you push (option 1)."
        fi
        ;;

    *)
        echo "git.sh: invalid option." >&2
        exit 1
        ;;
esac
