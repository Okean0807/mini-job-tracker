#!/usr/bin/env bash
# Resolve the git log range gitleaks must scan. Prints the --log-opts value on stdout.
# Never silently narrows to the last commit: if the incremental range is not safe,
# it falls back to the FULL ancestry of the tip (or fails).
#
# Inputs (env): EVENT (pull_request|push|workflow_dispatch|schedule),
#   PR_BASE, PR_HEAD (pull_request), PUSH_BEFORE, PUSH_AFTER (push).
set -euo pipefail

ZERO="0000000000000000000000000000000000000000"
die() { echo "gitleaks-range: $*" >&2; exit 2; }
is_commit() { [ -n "${1:-}" ] && git cat-file -e "${1}^{commit}" 2>/dev/null; }

case "${EVENT:-}" in
  pull_request)
    is_commit "${PR_HEAD:-}" || die "PR head not available"
    is_commit "${PR_BASE:-}" || die "PR base not available"
    mb=$(git merge-base "$PR_BASE" "$PR_HEAD") || die "no merge-base for PR"
    echo "${mb}..${PR_HEAD}"
    ;;
  push)
    is_commit "${PUSH_AFTER:-}" || die "push tip not available"
    if [ -n "${PUSH_BEFORE:-}" ] && [ "$PUSH_BEFORE" != "$ZERO" ] \
       && is_commit "$PUSH_BEFORE" \
       && git merge-base --is-ancestor "$PUSH_BEFORE" "$PUSH_AFTER"; then
      echo "${PUSH_BEFORE}..${PUSH_AFTER}"
    else
      # new branch, force-push or unreachable before: scan the whole ancestry of the tip
      echo "gitleaks-range: before unusable -> full ancestry of ${PUSH_AFTER}" >&2
      echo "${PUSH_AFTER}"
    fi
    ;;
  workflow_dispatch|schedule)
    echo "--all"
    ;;
  *)
    die "unsupported event '${EVENT:-}'"
    ;;
esac
