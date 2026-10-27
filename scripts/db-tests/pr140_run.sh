#!/usr/bin/env bash
# Behavioural tests for PR #140 (consume_ai_rate_limit). NOT part of CI.
# Runs ONLY against an isolated local PostgreSQL reached via a unix socket
# (PGHOST must be a directory; TCP hosts are refused). Never point this at prod.
# Usage: PGHOST=/tmp/pg140/sock PGPORT=55417 scripts/db-tests/pr140_run.sh [function.sql]
#   ONLY_CONCURRENCY=1 skips the functional cases (e.g. to compare an older body).
#   function.sql defaults to supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
FUNC=${1:-supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql}
DB=pr140_$$
D=scripts/db-tests
U=11111111-1111-1111-1111-111111111111
FAILS=0
psql -qX -d postgres -c "create database $DB" >/dev/null
trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
P() { psql -qX -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
for r in anon authenticated service_role tester; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true; done
P -f $D/pr140_stub.sql
P -f supabase/migrations/20260930192406_p1_ai_rate_limit.sql
P -f supabase/migrations/20260930192446_p1_security_definer_execute_hardening.sql
echo "== OLD body (192406 + 192446): F-1 reproduction"
P -At -f $D/pr140_old_bypass.sql
burst() { # $1 label; 20 parallel sessions, one call each, fresh row
  P -c "select t.reset('$U')" >/dev/null
  for i in $(seq 1 20); do
    psql -qXAt -d "$DB" -c "set role authenticated; set request.jwt.claim.sub='$U'; select allowed from public.consume_ai_rate_limit('$U')" > /tmp/pr140_b_$$_$i &
  done; wait
  local n; n=$(cat /tmp/pr140_b_$$_* | grep -c '^t$' || true); rm -f /tmp/pr140_b_$$_*
  local c; c=$(P -At -c "select cardinality(minute_stamps) from public.ai_rate_limits where user_id='$U'")
  echo "$1: burst 20 parallel -> allowed=$n stored=$c"
  [[ "$n" -le 8 && "$c" -le 8 ]] || { echo "FAIL $1 burst exceeded 8"; FAILS=$((FAILS+1)); }
}
lockwait() { # holder locks the row, waiter starts, holder writes 8 stamps 'now+1s' and commits
  P -c "select t.reset('$U')" >/dev/null
  psql -qXAt -d "$DB" -c "begin; select 1 from public.ai_rate_limits where user_id='$U' for update; select pg_sleep(1.5);
    update public.ai_rate_limits set minute_stamps=array(select t.now_ms() from generate_series(1,8)), hour_stamps=array(select t.now_ms() from generate_series(1,8)) where user_id='$U'; commit;" >/dev/null &
  sleep 0.3
  local a; a=$(psql -qXAt -d "$DB" -c "set role authenticated; set request.jwt.claim.sub='$U'; select allowed from public.consume_ai_rate_limit('$U')")
  wait
  local c; c=$(P -At -c "select cardinality(minute_stamps) from public.ai_rate_limits where user_id='$U'")
  echo "$1: lock-wait (8 stamps committed while waiting) -> waiter allowed=$a stored=$c (expected: f / 8)"
  [[ "$a" == f && "$c" == 8 ]] || { echo "FAIL $1 lock-wait under-count (F-140-1)"; FAILS=$((FAILS+1)); }
}
burst "OLD"
echo "== NEW body: $FUNC"
P -f "$FUNC"
if [[ -z "${ONLY_CONCURRENCY:-}" ]]; then
OUT=$(P -At -f $D/pr140_new_behaviour.sql 2>&1) || { echo "$OUT"; echo "FAIL new behaviour script"; exit 1; }
echo "$OUT" | grep -v '^(t,0)$' | grep -v '^$'
[[ $(grep -c 'permission denied for function consume_ai_rate_limit' <<<"$OUT") == 1 ]] || { echo "FAIL c16 anon"; FAILS=$((FAILS+1)); }
[[ $(grep -c 'ERROR:  forbidden' <<<"$OUT") == 3 ]] || { echo "FAIL c17-19 forbidden"; FAILS=$((FAILS+1)); }
fi
burst "NEW"; burst "NEW(repeat)"
lockwait "NEW"
echo "== DONE failures=$FAILS"
[[ $FAILS == 0 ]]
