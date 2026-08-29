#!/usr/bin/env bash
#
# scripts/git.sh — everyday git helper for this repo. Run from anywhere;
# always operates on the project root (one level up from this script).
#
#   Option 1: Push        — first auto-untracks anything that's tracked but
#                            matches .gitignore (the exact bug class that bit
#                            us before), regenerates config/manifest.txt (a
#                            flat list of every tracked, non-gitignored file
#                            — used by the update system to detect files that
#                            were removed between two releases), then stages
#                            everything, commits with a message you type, and
#                            pushes. If the push is rejected because the
#                            remote has commits you don't have locally (e.g.
#                            someone edited a file via the GitHub web UI),
#                            you're asked whether to abort (default) or force
#                            the local commit history over the remote,
#                            discarding whatever changes exist there.
#   Option 2: .gitignore   — type a path (relative to repo root). If it's not
#                            already ignored, it gets added. If it's already
#                            ignored, it gets removed (toggle). Leave the
#                            prompt blank to just print the current
#                            .gitignore. If the path doesn't exist on disk,
#                            the script exits without changing anything.
#
# NOTE: this script must NEVER be run with sudo/as root — see the check
# immediately below for why.
#
set -euo pipefail

BRANCH="main"
MANIFEST_PATH="config/manifest.txt"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── Refuse to run as root/sudo ────────────────────────────────────────────────
#
# git operations here (committing, pushing, reading/writing .gitignore) are
# tied to YOUR normal user account — SSH keys/credentials in ~/.ssh or the
# credential helper, git's own user.name/user.email config, and file
# ownership of everything this script touches or creates (config/manifest.txt,
# .gitignore, any new commits). Running this under sudo would either silently
# use root's (probably nonexistent) git identity/SSH keys and fail, or worse,
# leave root-owned files behind in what's supposed to be your normal
# checkout. There's nothing in this script that legitimately needs elevated
# privileges, so it simply refuses to run as root at all.
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

# Finds any file that is BOTH currently tracked by git AND matches a rule in
# .gitignore, and untracks it (git rm --cached) without touching the file on
# disk. This is what prevents the "added a .gitignore rule after the fact and
# it silently kept getting committed anyway" bug from ever recurring.
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

# Regenerates config/manifest.txt — a flat, sorted list (one path per line,
# relative to repo root) of every file that will actually be tracked/pushed
# in this commit, i.e. everything git would show via `git ls-files` once
# staging is complete. This deliberately runs AFTER `git add -A` so newly
# added files are already reflected in the index, and it excludes anything
# .gitignore'd since untrack_ignored_files + `git add -A` never stage those.
#
# This file is what scripts/update.sh uses to diff "what files exist in
# release A vs release B" WITHOUT downloading either release's full source
# archive — it just reads this one small text file from each tag via
# raw.githubusercontent.com.
regenerate_manifest() {
    mkdir -p "$(dirname "${MANIFEST_PATH}")"
    git ls-files | sort > "${MANIFEST_PATH}"
    git add "${MANIFEST_PATH}"
}

# Handles a rejected push. This happens when the remote branch has commits
# that don't exist locally — e.g. a file was edited directly on the GitHub
# web UI, which creates a commit on the remote that your local checkout
# never fetched. Default behavior is to abort and leave everything exactly
# as committed locally (nothing is lost — your commit still exists locally,
# it's just not pushed yet). Opting to override force-pushes your local
# history over the remote, permanently discarding whatever changes exist
# there that you don't have locally.
handle_push_rejection() {
    echo
    echo "git.sh: push was rejected — the remote has commits you don't have" >&2
    echo "        locally (e.g. a file was edited on the GitHub web UI)." >&2
    echo
    read -rp "Abort and keep remote as-is, or override remote with your local history? [A(bort)/o(verride)] (default: abort): " resolution

    case "${resolution}" in
        [Oo]|[Oo][Vv][Ee][Rr][Rr][Ii][Dd][Ee])
            echo "git.sh: force-pushing local history over remote — remote-only changes will be lost."
            git push --force-with-lease origin "${BRANCH}"
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
            echo "git.sh: note — if \"${entry}\" was already tracked by git, it will be"
            echo "        automatically untracked the next time you push (option 1)."
        fi
        ;;

    *)
        echo "git.sh: invalid option." >&2
        exit 1
        ;;
esac
