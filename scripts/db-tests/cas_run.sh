#!/usr/bin/env bash
# Phase 5: CAS behaviour against a REAL PostgreSQL (the repo's real `backups` migrations + RLS).
# NOT part of CI. Runs ONLY against an isolated local PostgreSQL reached via a unix socket
# (PGHOST must be a directory; TCP hosts are refused). Never point this at Supabase.
#
# NOT PostgREST: PostgREST translates the HTTP requests to the SQL used here (see cas_cases.sql);
# the translation itself is not exercised. Client-side request shape is covered by
# src/lib/minijob/cloud-cas.request-shape.test.ts (real @supabase/postgrest-js).
#
# Usage: PGHOST=/tmp/pg5/sock PGPORT=55432 scripts/db-tests/cas_run.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
DB=cas_$$
D=scripts/db-tests
M=supabase/migrations
U=11111111-1111-1111-1111-111111111111
psql -qX -d postgres -c "create database $DB" >/dev/null || exit 2
trap 'psql -qX -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; for r in anon authenticated service_role; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1; done' EXIT
for r in anon authenticated service_role; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true; done
P() { psql -qX -d "$DB" "$@"; }

P -v ON_ERROR_STOP=1 -f $D/cas_stub.sql >/dev/null
# REAL migrations: table + original policy, then the RLS hardening policy for backups only.
P -v ON_ERROR_STOP=1 -f $M/20260812221841_87a89883-538d-4966-9495-bdf2a0d1f782.sql >/dev/null
sed -n '/DROP POLICY IF EXISTS "Users manage own backup"/,/WITH CHECK ((select auth.uid()) = user_id);/p' \
  $M/20260930192515_p1_rls_performance_hardening.sql | P -v ON_ERROR_STOP=1 >/dev/null
echo "== schema under test"; P -Atc "select column_name||' '||data_type||' default='||coalesce(column_default,'-') from information_schema.columns where table_name='backups' order by ordinal_position"
P -Atc "select 'policy: '||policyname||' cmd='||cmd||' roles='||roles::text from pg_policies where tablename='backups'"
P -Atc "select 'triggers on backups: '||count(*) from pg_trigger where tgrelid='public.backups'::regclass and not tgisinternal"

echo; echo "== functional cases"
P -f $D/cas_cases.sql > /tmp/cas_cases.out 2>&1
# Unexpected script errors (typos etc.) count as failures; expected SQLSTATE errors are asserted in DO blocks.
UNEXPECTED=$(grep -c "^psql:.*ERROR" /tmp/cas_cases.out)
P -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||label from t.results order by id"
[[ "$UNEXPECTED" == 0 ]] || { echo "FAIL script errors in cas_cases.sql:"; grep "^psql:.*ERROR" /tmp/cas_cases.out; }
FAILS=$(( $(P -Atc "select count(*) from t.results where not ok") + UNEXPECTED ))

# helper: one request as user $1 (PostgREST-style claims), returns number of rows / SQLSTATE
REQ() { # $1 sub  $2 sql returning a count via CTE
  psql -qX -At -v VERBOSITY=verbose -d "$DB" <<SQL 2>&1
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"$1","role":"authenticated"}', true);
$2
commit;
SQL
}
reset_row() { # $1 token
  P -qAt <<SQL >/dev/null
delete from public.backups; delete from auth.users where id <> '$U';
insert into auth.users values ('$U') on conflict do nothing;
insert into public.backups(user_id,payload,updated_at) values ('$U','{"v":0}','$1');
SQL
}

echo; echo "== concurrency A: 8 writers race on the SAME observed token (20 rounds) -> exactly one wins per round"
BAD=0
for round in $(seq 1 20); do
  reset_row "2026-11-17T10:00:00.000Z"
  rm -f /tmp/cas_a_*.out
  for w in $(seq 1 8); do
    ( REQ "$U" "with u as (update public.backups set payload = '{\"w\":$w}', updated_at = '2026-11-17T10:00:0$((w % 9 + 1)).000Z' where user_id = '$U' and updated_at = '2026-11-17T10:00:00+00:00' returning 1) select count(*) from u;" > /tmp/cas_a_$w.out ) &
  done
  wait
  WIN=$(cat /tmp/cas_a_*.out | grep -E '^[01]$' | paste -sd+ | bc)
  [[ "$WIN" == "1" ]] || { BAD=$((BAD+1)); echo "round $round: winners=$WIN"; }
done
if [[ $BAD -eq 0 ]]; then echo "PASS cA 20/20 rounds: exactly one of 8 concurrent writers matched the observed token"; else echo "FAIL cA $BAD/20 rounds had != 1 winner"; FAILS=$((FAILS+1)); fi

echo; echo "== concurrency B: row lock - a second writer BLOCKS, then re-evaluates the condition and matches ZERO rows"
reset_row "2026-11-17T10:00:00.000Z"
( psql -qX -At -d "$DB" <<SQL > /tmp/cas_b1.out 2>&1
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"$U"}',true);
with u as (update public.backups set payload='{"w":"first"}', updated_at='2026-11-17T10:00:01Z' where user_id='$U' and updated_at='2026-11-17T10:00:00+00:00' returning 1) select count(*) from u;
select pg_sleep(1.5);
commit;
SQL
) &
sleep 0.4
T0=$(date +%s.%N)
REQ "$U" "with u as (update public.backups set payload='{\"w\":\"second\"}', updated_at='2026-11-17T10:00:02Z' where user_id='$U' and updated_at='2026-11-17T10:00:00+00:00' returning 1) select count(*) from u;" > /tmp/cas_b2.out
T1=$(date +%s.%N); wait
FIRST=$(grep -E '^[01]$' /tmp/cas_b1.out | head -1); SECOND=$(grep -E '^[01]$' /tmp/cas_b2.out | head -1)
BLOCKED=$(echo "$T1 - $T0 > 0.8" | bc -l)
FINAL=$(P -Atc "select payload::text from public.backups")
if [[ "$FIRST" == 1 && "$SECOND" == 0 && "$BLOCKED" == 1 && "$FINAL" == '{"w": "first"}' ]]; then echo "PASS cB first writer matched 1 row; second blocked $(printf '%.2f' "$(echo "$T1 - $T0" | bc -l)")s on the row lock, then matched 0 rows; final payload = first writer's"; else echo "FAIL cB first=$FIRST second=$SECOND blocked=$BLOCKED final=$FINAL"; FAILS=$((FAILS+1)); fi

echo; echo "== concurrency C: 8 concurrent INSERTs for the same new account -> exactly one succeeds, others 23505"
BAD=0
for round in $(seq 1 10); do
  P -qAt -c "delete from public.backups" >/dev/null
  rm -f /tmp/cas_c_*.out
  for w in $(seq 1 8); do
    ( REQ "$U" "insert into public.backups(user_id,payload,updated_at) values ('$U','{\"w\":$w}','2026-11-17T10:00:00Z') returning 1;" > /tmp/cas_c_$w.out ) &
  done
  wait
  OK=$(cat /tmp/cas_c_*.out | grep -c '^1$'); DUP=$(cat /tmp/cas_c_*.out | grep -c '23505')
  [[ "$OK" == 1 && "$DUP" == 7 ]] || { BAD=$((BAD+1)); echo "round $round: ok=$OK dup=$DUP"; }
done
if [[ $BAD -eq 0 ]]; then echo "PASS cC 10/10 rounds: exactly one INSERT won, 7 failed with SQLSTATE 23505"; else echo "FAIL cC $BAD/10 rounds"; FAILS=$((FAILS+1)); fi

echo; echo "== concurrency D: CAS update racing the account DELETE (FK cascade) -> no zombie row, no error"
reset_row "2026-11-17T10:00:00.000Z"
( psql -qX -At -d "$DB" -c "begin; delete from auth.users where id='$U'; select pg_sleep(1); commit;" >/dev/null 2>&1 ) &
sleep 0.3
OUT=$(REQ "$U" "with u as (update public.backups set payload='{\"z\":1}', updated_at='2026-11-17T10:00:09Z' where user_id='$U' and updated_at='2026-11-17T10:00:00+00:00' returning 1) select count(*) from u;"); wait
LEFT=$(P -Atc "select count(*) from public.backups")
if echo "$OUT" | grep -qE '^0$' && [[ "$LEFT" == 0 ]]; then echo "PASS cD the update waited for the delete, then matched 0 rows; backups rows left: $LEFT"; else echo "FAIL cD out=$OUT left=$LEFT"; FAILS=$((FAILS+1)); fi

echo; echo "== PROPOSAL prototype (docs/data-safety/proposed-backups-rev-trigger.sql - NOT a migration, throwaway DB only)"
reset_row "2026-11-17T10:00:00.000Z"
P -v ON_ERROR_STOP=1 -f docs/data-safety/proposed-backups-rev-trigger.sql >/dev/null
P -Atc "select 'rev after proposal on existing row = '||rev from public.backups"
# legacy blind writes now bump rev, so a CAS client holding rev=1 notices them:
P -qAt >/dev/null <<SQL
set role authenticated; select set_config('request.jwt.claims','{"sub":"$U"}',false);
update public.backups set payload = '{"silent":"change"}' where user_id = '$U';
SQL
R1=$(P -Atc "select rev from public.backups")
P -qAt >/dev/null <<SQL
set role authenticated; select set_config('request.jwt.claims','{"sub":"$U"}',false);
update public.backups set payload = '{"aba":1}', updated_at = '2026-11-17T10:00:00Z' where user_id = '$U';
SQL
R2=$(P -Atc "select rev from public.backups")
HIT=$(REQ "$U" "with u as (update public.backups set payload='{\"cas\":1}' where user_id='$U' and rev = 1 returning 1) select count(*) from u;" | grep -E '^[01]$')
if [[ "$R1" == 2 && "$R2" == 3 && "$HIT" == 0 ]]; then echo "PASS cP a payload change WITHOUT touching updated_at (rev 1->$R1) and an updated_at re-use/ABA (rev ->$R2) are both visible to a rev-based CAS (stale rev matches $HIT rows); the old-client write itself was still accepted (stage 1 is non-breaking)"; else echo "FAIL cP r1=$R1 r2=$R2 hit=$HIT"; FAILS=$((FAILS+1)); fi

echo; echo "== SUMMARY: functional $(P -Atc "select count(*) filter (where ok)||' passed, '||count(*) filter (where not ok)||' failed' from t.results"), total failures: $FAILS"
exit $([[ $FAILS -eq 0 ]] && echo 0 || echo 1)
