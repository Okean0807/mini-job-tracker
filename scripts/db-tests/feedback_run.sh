#!/usr/bin/env bash
# Behavioural tests for the Feedback migration draft. NOT part of CI, NOT run against Supabase.
# Runs ONLY against an isolated local PostgreSQL reached via a unix socket
# (PGHOST must be a directory; TCP hosts are refused). Never point this at prod.
# (Supabase-like default privileges are replicated for the plain owner role.)
# Usage: PGHOST=/tmp/pgfb/sock PGPORT=55418 scripts/db-tests/feedback_run.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
D=scripts/db-tests
MIG=supabase/pending/20261028120000_feedback.sql
DB=feedback_$$
DB2=${DB}_owner
DB3=${DB}_force
cleanup() {
  for d in "$DB" "$DB2" "$DB3"; do psql -qX -d postgres -c "drop database if exists $d" >/dev/null 2>&1 || true; done
  psql -qX -d postgres -c "drop role if exists fb_owner" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql -qX -d postgres -c "drop role if exists fb_owner" >/dev/null 2>&1 || true
P() { psql -qX -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

echo "== A. superuser owner: functional + access model"
psql -qX -d postgres -c "create database $DB" >/dev/null
P "$DB" -f $D/feedback_stub.sql >/dev/null
P "$DB" -f $MIG
P "$DB" -f $D/feedback_behaviour.sql

echo "== B. concurrency: 12 parallel submissions from one client key, limit is 5/hour"
P "$DB" -c "truncate public.feedback, public.feedback_rate_limits" >/dev/null
for i in $(seq 1 12); do
  ( psql -qXAt -d "$DB" -c "set role service_role; select status from public.submit_feedback(gen_random_uuid(), 'idea', 'parallel $i', null, '1.0', 'de', '/', 'burst-client')" > /tmp/fb_b_$$_$i ) &
done; wait
n=$(cat /tmp/fb_b_$$_* | grep -c '^created$' || true); rm -f /tmp/fb_b_$$_*
c=$(P "$DB" -At -c "select count(*) from public.feedback")
echo "created=$n stored=$c"
[[ "$n" -eq 5 && "$c" -eq 5 ]] || { echo "FAIL concurrency: expected exactly 5"; exit 1; }

echo "== C. owner WITHOUT superuser and WITHOUT BYPASSRLS owns the objects"
psql -qX -d postgres -c "create role fb_owner login nosuperuser nobypassrls" >/dev/null
psql -qX -d postgres -c "create database $DB2" >/dev/null
P "$DB2" -f $D/feedback_stub.sql >/dev/null
P "$DB2" -c "grant create, usage on schema public to fb_owner" >/dev/null
P "$DB2" -c "alter default privileges for role fb_owner in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role fb_owner in schema public grant execute on functions to anon, authenticated, service_role" >/dev/null
PGUSER=fb_owner psql -qX -v ON_ERROR_STOP=1 -d "$DB2" -f $MIG >/dev/null
P "$DB2" -f $D/feedback_owner.sql
P "$DB2" -f $D/feedback_behaviour.sql | grep -c PASS | sed 's/^/behaviour checks passed with that owner: /'

echo "== D. regression demo: the old FORCE ROW LEVEL SECURITY variant breaks for that owner (expected)"
psql -qX -d postgres -c "create database $DB3" >/dev/null
P "$DB3" -f $D/feedback_stub.sql >/dev/null
P "$DB3" -c "grant create, usage on schema public to fb_owner" >/dev/null
P "$DB3" -c "alter default privileges for role fb_owner in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role fb_owner in schema public grant execute on functions to anon, authenticated, service_role" >/dev/null
PGUSER=fb_owner psql -qX -v ON_ERROR_STOP=1 -d "$DB3" -f $MIG >/dev/null
P "$DB3" -c "alter table public.feedback_rate_limits force row level security; alter table public.feedback force row level security" >/dev/null
forced_out=$(psql -qX -d "$DB3" -c "set role service_role; select * from public.submit_feedback(gen_random_uuid(),'bug','abcdef',null,'1.0','de','/','k')" 2>&1 || true)
if grep -q "row-level security policy" <<<"$forced_out"; then
  echo "PASS forced RLS breaks a non-BYPASSRLS owner (why FORCE was removed)"
else
  echo "FAIL expected the forced variant to fail"; exit 1
fi

echo "== E. rollback file"
P "$DB" -f supabase/pending/rollback/20261028120000_feedback.rollback.sql
P "$DB" -At -c "select to_regclass('public.feedback') is null and to_regclass('public.feedback_rate_limits') is null" | grep -q '^t$' && echo "PASS rollback removes everything"
echo "ALL FEEDBACK DB TESTS PASSED"
