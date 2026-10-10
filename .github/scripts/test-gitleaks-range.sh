#!/usr/bin/env bash
# Harness: builds throwaway repos in a temp dir with synthetic secrets generated at
# runtime (never committed to this repository) and asserts gitleaks-scan.sh behaviour.
# Usage: GITLEAKS=/abs/path/gitleaks .github/scripts/test-gitleaks-range.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SCAN="$here/gitleaks-scan.sh"
: "${GITLEAKS:?set GITLEAKS to the gitleaks binary}"
export GITLEAKS
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fail=0; pass=0
ZERO="0000000000000000000000000000000000000000"

fake() { printf 'ghp_%s' "$(head -c 512 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | head -c 36)"; }
repo() { d="$work/$1"; rm -rf "$d"; git init -q -b main "$d"; cd "$d";
  git config user.name t; git config user.email t@example.invalid;
  echo base > README; git add .; git commit -qm base; }
c() { echo "$2" >> "$1"; git add "$1"; git commit -qm "$3"; }
secret_commit() { c "$1" "TOKEN=$(fake)" "${2:-secret}"; }
clean_commit() { c notes.txt "line $RANDOM" "${1:-clean}"; }
expect() { # name expected(block|pass) env...
  name=$1; want=$2; shift 2
  out=$(env "$@" "$SCAN" 2>&1); rc=$?
  got=pass; if [ $rc -eq 1 ]; then echo "$out" | grep -q "leaks found:" && got=block || got="error(1)"; fi
  if [ "$rc" -gt 1 ]; then got="error($rc)"; fi
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "PASS  $name -> $got";
  else fail=$((fail+1)); echo "FAIL  $name -> got $got want $want"; echo "$out" | grep -v -i 'secret:' | tail -5; fi
}

# 1 secret in normal new commit (push)
repo s1; b=$(git rev-parse HEAD); secret_commit app.env; a=$(git rev-parse HEAD)
expect "push: secret in new commit" block EVENT=push PUSH_BEFORE=$b PUSH_AFTER=$a

# 2 secret in second-to-last commit of a multi-commit push
repo s2; b=$(git rev-parse HEAD); clean_commit; secret_commit app.env; clean_commit; a=$(git rev-parse HEAD)
expect "push: secret in second-to-last of 3 commits" block EVENT=push PUSH_BEFORE=$b PUSH_AFTER=$a

# 3 clean diff passes
repo s3; b=$(git rev-parse HEAD); clean_commit; clean_commit; a=$(git rev-parse HEAD)
expect "push: clean multi-commit diff" pass EVENT=push PUSH_BEFORE=$b PUSH_AFTER=$a

# 4 new branch (zero before), secret not in tip
repo s4; secret_commit app.env; clean_commit; a=$(git rev-parse HEAD)
expect "push: new branch (zero before), secret in older commit" block EVENT=push PUSH_BEFORE=$ZERO PUSH_AFTER=$a
expect "push: empty before" block EVENT=push PUSH_BEFORE= PUSH_AFTER=$a

# 5 force-push: before unreachable / not ancestor
repo s5; clean_commit; old=$(git rev-parse HEAD); git reset -q --hard HEAD~1
secret_commit app.env; clean_commit; a=$(git rev-parse HEAD)
expect "push: force-push (before not ancestor)" block EVENT=push PUSH_BEFORE=$old PUSH_AFTER=$a
expect "push: force-push (before unknown sha)" block EVENT=push PUSH_BEFORE=1111111111111111111111111111111111111111 PUSH_AFTER=$a

# 6 PR range uses merge-base (base moved ahead after branching)
repo s6; git checkout -q -b feat; clean_commit; secret_commit app.env; clean_commit; h=$(git rev-parse HEAD)
git checkout -q main; clean_commit "main moved"; base=$(git rev-parse HEAD)
expect "pr: secret in middle commit, base advanced" block EVENT=pull_request PR_BASE=$base PR_HEAD=$h
repo s6b; git checkout -q -b feat; clean_commit; h=$(git rev-parse HEAD); git checkout -q main; base=$(git rev-parse HEAD)
expect "pr: clean" pass EVENT=pull_request PR_BASE=$base PR_HEAD=$h

# 7 historical exact-fingerprint ignore does not hide another secret in same file
repo s7; secret_commit legacy.env "historical"; hc=$(git rev-parse HEAD)
echo "${hc}:legacy.env:github-pat:1" > .gitleaksignore; git add .gitleaksignore; git commit -qm ignore
expect "full: only ignored historical finding" pass EVENT=workflow_dispatch
b=$(git rev-parse HEAD); secret_commit legacy.env "another"; a=$(git rev-parse HEAD)
expect "push: other secret in same file not suppressed" block EVENT=push PUSH_BEFORE=$b PUSH_AFTER=$a
expect "full: other secret in same file not suppressed" block EVENT=workflow_dispatch

# 8 unresolvable range fails closed
repo s8
expect "pr: missing head fails closed" "error(2)" EVENT=pull_request PR_BASE=$(git rev-parse HEAD) PR_HEAD=$ZERO
expect "unknown event fails closed" "error(2)" EVENT=bogus

# 9 evil merge: secret only in conflict resolution of a merge commit
expect_dir() { # name want(pass|block)
  name=$1; want=$2
  out=$("$GITLEAKS" dir --no-banner --redact --exit-code 1 . 2>&1); rc=$?
  got=pass; if [ $rc -eq 1 ]; then echo "$out" | grep -q "leaks found:" && got=block || got="error(1)"; fi
  [ "$rc" -gt 1 ] && got="error($rc)"
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "PASS  $name -> $got";
  else fail=$((fail+1)); echo "FAIL  $name -> got $got want $want"; fi
}
repo s9; echo "v=0" > conf.txt; git add conf.txt; git commit -qm c0
git checkout -q -b side; echo "v=side" > conf.txt; git commit -qam side
git checkout -q main; echo "v=main" > conf.txt; git commit -qam main
git merge -q side >/dev/null 2>&1 || true
tok=$(fake); printf 'v=resolved\nTOKEN=%s\n' "$tok" > conf.txt; git add conf.txt; git commit -qm "merge side"
out=$(EVENT=workflow_dispatch "$SCAN" 2>&1); rc=$?
if [ $rc -eq 0 ]; then pass=$((pass+1)); echo "PASS  evil merge: git --all scan misses it (documented limit) -> exit 0";
else fail=$((fail+1)); echo "FAIL  evil merge: git --all scan expected exit 0, got $rc"; fi
expect_dir "evil merge: dir scan of tree catches it" block
dout=$("$GITLEAKS" dir --no-banner --redact --verbose --exit-code 1 . 2>&1 || true)
if printf '%s' "$dout$out" | grep -qF "${tok:4}"; then fail=$((fail+1)); echo "FAIL  redaction: token substring in output";
else pass=$((pass+1)); echo "PASS  redaction: no token substring in output"; fi
repo s10; clean_commit
expect_dir "dir scan: clean tree" pass

echo "harness: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
