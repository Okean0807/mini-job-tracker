#!/usr/bin/env bash
# F-1 + pending RLS (20260930220000) on the same isolated, socket-only cluster as
# f1_isolated_run.sh: proves the rate-limit RPC keeps working with RLS enabled and
# no policies, and asserts that RLS is really on (rls_assert.sql).
# Never connects anywhere else: all checks run inside f1_isolated_run.sh.
# Usage: PG_BIN=/path/to/pg/bin EXPECT_VERSION="<exact server_version>" \
#        EVIDENCE_DIR=/path scripts/db-tests/f1_rls_isolated_run.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
[[ $(id -u) -ne 0 ]] || { echo "refusing: run as a non-root user (initdb refuses root)"; exit 2; }
F1=supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql
RLS=supabase/pending/20260930220000_p1_ai_rate_limit_rls.sql
ASSERT=scripts/db-tests/rls_assert.sql
for f in "$F1" "$RLS" "$ASSERT"; do [[ -f $f ]] || { echo "missing $f"; exit 2; }; done
TMP=$(mktemp -d /tmp/f1rls-XXXXXXXX)
trap 'rm -rf -- "$TMP"' EXIT
COMBINED="$TMP/f1_plus_rls.sql"
cat "$F1" "$RLS" "$ASSERT" > "$COMBINED"
echo "combined: $F1 + $RLS + $ASSERT -> sha256 $(sha256sum "$COMBINED" | cut -d' ' -f1)"
OUT="$TMP/run.out"
rc=0
scripts/db-tests/f1_isolated_run.sh "$COMBINED" 2>&1 | tee "$OUT" || rc=$?
# Keep the runner's own code (e.g. 3 = BLOCKED endpoint) when it failed.
[[ $rc -eq 0 ]] || { echo "runner failed (exit $rc)"; exit "$rc"; }
# The assertion runs once per database the function file is applied to; it must
# have succeeded at least once and never failed.
ok=$(grep -c 'RLS_ASSERT_OK' "$OUT" || true)
if grep -q 'RLS_ASSERT_FAILED' "$OUT" || [[ $ok -lt 1 ]]; then
  echo "RLS assertion missing or failed (ok=$ok)"; exit 1
fi
echo "rls_assert ok=$ok runner_exit=$rc"
exit "$rc"
