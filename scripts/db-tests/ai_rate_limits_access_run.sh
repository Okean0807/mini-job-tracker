#!/usr/bin/env bash
# Direct-access test for public.ai_rate_limits on the same isolated, socket-only
# cluster as f1_isolated_run.sh: API roles (anon, authenticated) have no table
# privileges and every direct statement fails with 42501, while
# consume_ai_rate_limit() still works for the token user (privileges_assert.sql).
# Never connects anywhere else: all checks run inside f1_isolated_run.sh.
# Usage: PG_BIN=/path/to/pg/bin EXPECT_VERSION="<exact server_version>" \
#        EVIDENCE_DIR=/path scripts/db-tests/ai_rate_limits_access_run.sh f1|f1+rls
#   f1      F-1 only: the state Production gets on merge (RLS still off)
#   f1+rls  F-1 + pending RLS migration, plus rls_assert.sql
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $(id -u) -ne 0 ]] || { echo "refusing: run as a non-root user (initdb refuses root)"; exit 2; }
MODE=${1:-}
[[ $MODE == f1 || $MODE == f1+rls ]] || { echo "usage: $0 f1|f1+rls"; exit 2; }
D=scripts/db-tests
FILES=(supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql)
[[ $MODE == f1+rls ]] && FILES+=(supabase/pending/20260930220000_p1_ai_rate_limit_rls.sql "$D/rls_assert.sql")
FILES+=("$D/privileges_assert.sql")
for f in "${FILES[@]}"; do [[ -f $f ]] || { echo "missing $f"; exit 2; }; done
TMP=$(mktemp -d /tmp/f1priv-XXXXXXXX)
trap 'rm -rf -- "$TMP"' EXIT
COMBINED="$TMP/combined.sql"
cat "${FILES[@]}" > "$COMBINED"
echo "mode=$MODE combined: ${FILES[*]} -> sha256 $(sha256sum "$COMBINED" | cut -d' ' -f1)"
OUT="$TMP/run.out"
rc=0
"$D/f1_isolated_run.sh" "$COMBINED" 2>&1 | tee "$OUT" || rc=$?
# Keep the runner's own code (e.g. 3 = BLOCKED endpoint) when it failed.
[[ $rc -eq 0 ]] || { echo "runner failed (exit $rc)"; exit "$rc"; }
# The assertions run once per database the combined file is applied to; they must
# have succeeded at least once and never failed.
fail=0
check() { # $1 marker
  local ok; ok=$(grep -c "$1_OK" "$OUT" || true)
  if grep -q "$1_FAILED" "$OUT" || [[ $ok -lt 1 ]]; then echo "$1 missing or failed (ok=$ok)"; fail=1; fi
  echo "$1 ok=$ok"
}
check PRIV_ASSERT
[[ $MODE == f1+rls ]] && check RLS_ASSERT
[[ $fail -eq 0 ]] || exit 1
echo "access test ($MODE) passed, runner_exit=$rc"
