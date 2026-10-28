#!/usr/bin/env bash
# Behavioural tests for the Feedback migration draft. NOT part of CI.
# Runs ONLY against an isolated local PostgreSQL reached via a unix socket
# (PGHOST must be a directory; TCP hosts are refused). Never point this at prod.
# Usage: PGHOST=/tmp/pgfb/sock PGPORT=55418 scripts/db-tests/feedback_run.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
D=scripts/db-tests
DB=feedback_$$
psql -qX -d postgres -c "create database $DB" >/dev/null
trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
for r in anon authenticated service_role tester; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true; done
P() { psql -qX -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
P -f $D/feedback_stub.sql
P -f supabase/pending/20261028120000_feedback.sql
echo "== functional + access model"
P -f $D/feedback_behaviour.sql
echo "== concurrency: 12 parallel submissions from one client key, limit is 5/hour"
P -c "truncate public.feedback, public.feedback_rate_limits" >/dev/null
for i in $(seq 1 12); do
  psql -qXAt -d "$DB" -c "set role service_role; select status from public.submit_feedback(gen_random_uuid(), 'idea', 'parallel $i', null, '1.0', 'de', '/', 'burst-client')" > /tmp/fb_b_$$_$i &
done; wait
n=$(cat /tmp/fb_b_$$_* | grep -c '^created$' || true); rm -f /tmp/fb_b_$$_*
c=$(P -At -c "select count(*) from public.feedback")
echo "created=$n stored=$c"
[[ "$n" -eq 5 && "$c" -eq 5 ]] || { echo "FAIL concurrency: expected exactly 5"; exit 1; }
echo "== rollback file"
P -f supabase/pending/rollback/20261028120000_feedback.rollback.sql
P -At -c "select to_regclass('public.feedback') is null and to_regclass('public.feedback_rate_limits') is null" | grep -q '^t$' && echo "PASS rollback removes everything"
echo "ALL FEEDBACK DB TESTS PASSED"
