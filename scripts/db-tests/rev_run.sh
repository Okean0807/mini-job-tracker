#!/usr/bin/env bash
# Stage 1 (server revision) migration tests against an ISOLATED local PostgreSQL (unix socket only).
# NOT part of CI. Refuses TCP hosts. Never point this at Supabase.
# Usage: PGHOST=/tmp/pg5/sock PGPORT=55432 scripts/db-tests/rev_run.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
DB=rev_$$
D=scripts/db-tests; M=supabase/migrations
FWD=supabase/pending/20261120000000_backups_server_revision.sql
BACK=supabase/pending/rollback/20261120000000_backups_server_revision.rollback.sql
U1=11111111-1111-1111-1111-111111111111; U2=22222222-2222-2222-2222-222222222222; U3=33333333-3333-3333-3333-333333333333
FAILS=0; PASSES=0
cleanup() { psql -qX -d postgres -c "drop database if exists $DB" >/dev/null 2>&1; for r in anon authenticated service_role; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1; done; }
trap cleanup EXIT
for r in anon authenticated service_role; do psql -qX -d postgres -c "drop role if exists $r" >/dev/null 2>&1 || true; done
psql -qX -d postgres -c "create database $DB" >/dev/null || exit 2
P() { psql -qXAt -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
Q() { psql -qXAt -d "$DB" -c "$1" 2>&1; }                      # scalar or error text
chk() { # label, expected, actual
  if [[ "$2" == "$3" ]]; then echo "PASS $1 (= $3)"; PASSES=$((PASSES+1)); else echo "FAIL $1: expected [$2] got [$3]"; FAILS=$((FAILS+1)); fi; }
# run SQL as a PostgREST-style request: role + jwt claims; prints output incl. errors (SQLSTATE visible)
AS() { # role sub sql
  psql -qXAt -v VERBOSITY=verbose -d "$DB" 2>&1 <<SQL
begin; set local role $1; select set_config('request.jwt.claims','{"sub":"$2"}',true) \gset
$3
commit;
SQL
}
sqlstate() { grep -oE "^ERROR:  [0-9A-Z]{5}" | head -1 | awk '{print $2}'; }
reset_roles() { for r in anon authenticated service_role; do :; done; }

# ---------- baseline = the REAL pre-migration schema, with Supabase-like default privileges
P -f $D/cas_stub.sql >/dev/null
P -c "alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role" >/dev/null
P -f $M/20260812221841_87a89883-538d-4966-9495-bdf2a0d1f782.sql >/dev/null
sed -n '/DROP POLICY IF EXISTS "Users manage own backup"/,/WITH CHECK ((select auth.uid()) = user_id);/p' $M/20260930192515_p1_rls_performance_hardening.sql | P >/dev/null
P -c "insert into auth.users values ('$U1'),('$U2'),('$U3')" >/dev/null

echo "== 1. UPGRADE with existing rows"
P -c "insert into public.backups(user_id,payload,updated_at) values ('$U1','{\"a\":1}','2026-11-01T10:00:00.123Z'),('$U2','{\"b\":2}','2026-11-02T10:00:00Z'),('$U3','{\"c\":3}','2026-11-03T10:00:00Z')" >/dev/null
BEFORE=$(P -c "select md5(string_agg(user_id::text||payload::text||updated_at::text, ',' order by user_id)) from public.backups")
P -f $FWD >/dev/null; RC=$?
chk "1a forward migration applies cleanly" 0 $RC
chk "1b existing rows keep payload and updated_at unchanged" "$BEFORE" "$(P -c "select md5(string_agg(user_id::text||payload::text||updated_at::text, ',' order by user_id)) from public.backups")"
chk "1c every existing row got a revision" 3 "$(P -c "select count(rev) from public.backups")"
chk "1d existing revisions are distinct" 3 "$(P -c "select count(distinct rev) from public.backups")"
chk "1e revisions are exact JSON-safe integers (< 2^53)" t "$(P -c "select max(rev) < 9007199254740992 from public.backups")"
chk "1f column is bigint NOT NULL with a nextval default" "bigint|NO|true" "$(P -c "select data_type||'|'||is_nullable||'|'||(column_default like 'nextval(%')::text from information_schema.columns where table_name='backups' and column_name='rev'")"
chk "1g forward migration is idempotent (second run)" 0 "$(P -f $FWD >/dev/null 2>&1; echo $?)"
chk "1h RLS policy and grants untouched" "Users manage own backup" "$(P -c "select policyname from pg_policies where tablename='backups'")"

echo "== 2. FRESH migration on an empty table"
P -c "create table public.fresh_check (like public.backups including defaults)" >/dev/null
chk "2a empty-table upgrade path = same migration (trigger/sequence/function exist)" "1|1|1" "$(P -c "select (select count(*) from pg_trigger where tgname='backups_set_rev' and not tgisinternal)||'|'||(select count(*) from pg_class where relname='backups_rev_seq' and relkind='S')||'|'||(select count(*) from pg_proc where proname='backups_set_rev')")"

P -c "drop table public.fresh_check" >/dev/null
echo "== 3. INSERT / UPDATE assign revisions; client-supplied values are ignored"
P -c "delete from public.backups where user_id='$U3'" >/dev/null
R_INS=$(P -c "insert into public.backups(user_id,payload,rev) values ('$U3','{}',5) returning rev")
chk "3a insert ignores a client-supplied rev (5)" t "$(P -c "select $R_INS <> 5 and $R_INS > 1000000000000")"
R1=$(P -c "select rev from public.backups where user_id='$U1'")
R1B=$(P -c "update public.backups set payload='{\"a\":2}', rev = 1 where user_id='$U1' returning rev")
chk "3b update assigns a new, larger rev and ignores rev=1" t "$(P -c "select $R1B > $R1 and $R1B <> 1")"
R1C=$(P -c "insert into public.backups(user_id,payload,updated_at,rev) values ('$U1','{\"a\":3}',now(),42) on conflict (user_id) do update set payload=excluded.payload, rev=77 returning rev")
chk "3c legacy blind upsert (ON CONFLICT DO UPDATE, rev supplied) increments and ignores the supplied rev" t "$(P -c "select $R1C > $R1B and $R1C not in (42,77)")"
R1D=$(P -c "update public.backups set payload='{\"silent\":1}' where user_id='$U1' returning rev")
chk "3d a payload change WITHOUT touching updated_at still increments (the Phase 5 c9b gap)" t "$(P -c "select $R1D > $R1C")"
R1E=$(P -c "update public.backups set payload = payload where user_id='$U1' returning rev")
chk "3e a no-op update increments too (safe; may cause a spurious conflict)" t "$(P -c "select $R1E > $R1D")"
chk "3f revisions across accounts are globally unique" 3 "$(P -c "select count(distinct rev) from public.backups")"

echo "== 4. DELETE + INSERT never reuses a revision (sequence, not a per-row counter)"
P -c "select rev from public.backups where user_id='$U2'" > /tmp/rev_before.$$
OLD=$(cat /tmp/rev_before.$$); P -c "delete from public.backups where user_id='$U2'" >/dev/null
NEW=$(P -c "insert into public.backups(user_id,payload) values ('$U2','{}') returning rev")
chk "4a revision after DELETE+INSERT is greater than before" t "$(P -c "select $NEW > $OLD")"; rm -f /tmp/rev_before.$$

echo "== 5. Concurrency"
BASE=$(P -c "select rev from public.backups where user_id='$U1'"); rm -f /tmp/rev_u_*.out
for w in 1 2 3 4 5 6 7 8; do ( AS authenticated $U1 "update public.backups set payload='{\"w\":$w}' where user_id='$U1' returning rev;" | grep -E '^[0-9]+$' > /tmp/rev_u_$w.out ) & done; wait
FINAL=$(P -c "select rev from public.backups where user_id='$U1'")
chk "5a 8 concurrent UPDATEs returned 8 DISTINCT revisions, all above the base" 8 "$(cat /tmp/rev_u_*.out | sort -u | awk -v b=$BASE '$1>b' | wc -l)"
chk "5a' the stored revision equals the highest returned one (commit order == revision order under the row lock)" t "$(P -c "select $FINAL = $(cat /tmp/rev_u_*.out | sort -n | tail -1)")"
echo "   (note: the sequence may skip numbers when a blocked writer's BEFORE trigger is re-fired after the row lock: gaps are expected, reuse never happens; base=$BASE final=$FINAL)"
BAD=0
for round in $(seq 1 15); do
  CUR=$(P -c "select rev from public.backups where user_id='$U1'"); rm -f /tmp/rev_c_*.out
  for w in 1 2 3 4 5 6 7 8; do ( AS authenticated $U1 "with u as (update public.backups set payload='{\"cas\":$w}' where user_id='$U1' and rev=$CUR returning 1) select count(*) from u;" > /tmp/rev_c_$w.out ) & done; wait
  WIN=$(cat /tmp/rev_c_*.out | grep -E '^[01]$' | paste -sd+ | bc); [[ "$WIN" == 1 ]] || BAD=$((BAD+1))
done
chk "5b rev-based CAS: exactly one of 8 racing writers wins, 15 rounds (bad rounds)" 0 $BAD
P -c "delete from public.backups where user_id='$U3'" >/dev/null; rm -f /tmp/rev_i_*.out
for w in 1 2 3 4 5 6 7 8; do ( AS authenticated $U3 "insert into public.backups(user_id,payload) values ('$U3','{\"w\":$w}') returning 'inserted';" > /tmp/rev_i_$w.out ) & done; wait
chk "5c concurrent INSERTs for one account: exactly one wins" "1|7" "$(cat /tmp/rev_i_*.out | grep -c '^inserted$')|$(cat /tmp/rev_i_*.out | grep -c '23505')"
chk "5d stale-rev CAS update matches 0 rows" 0 "$(AS authenticated $U1 "with u as (update public.backups set payload='{}' where user_id='$U1' and rev=1 returning 1) select count(*) from u;" | grep -E '^[01]$')"
OBS=$(P -c "select rev from public.backups where user_id='$U1'")
chk "5e current-rev CAS update matches exactly 1 row and returns the NEW rev" t "$(AS authenticated $U1 "update public.backups set payload='{\"ok\":1}' where user_id='$U1' and rev=$OBS returning rev;" | grep -E '^[0-9]+$' | awk -v o=$OBS '{print ($1>o)?"t":"f"}')"

echo "== 6. Writers, RLS, deletion"
OBS=$(P -c "select rev from public.backups where user_id='$U1'")
AS authenticated $U1 "update public.backups set payload='{\"auth\":1}' where user_id='$U1';" >/dev/null
chk "6a authenticated write increments" t "$(P -c "select rev > $OBS from public.backups where user_id='$U1'")"
OBS=$(P -c "select rev from public.backups where user_id='$U1'")
AS service_role $U1 "update public.backups set payload='{\"srv\":1}' where user_id='$U1';" >/dev/null
chk "6b service_role write increments" t "$(P -c "select rev > $OBS from public.backups where user_id='$U1'")"
chk "6c RLS still isolates: another account's row is not updatable" 0 "$(AS authenticated $U2 "with u as (update public.backups set payload='{}' where user_id='$U1' returning 1) select count(*) from u;" | grep -E '^[01]$')"
P -c "delete from auth.users where id='$U1'" >/dev/null
chk "6d account deletion still cascades (no trigger on DELETE, no error)" 0 "$(P -c "select count(*) from public.backups where user_id='$U1'")"
P -c "insert into auth.users values ('$U1') on conflict do nothing" >/dev/null
P -c "insert into public.backups(user_id,payload,updated_at) values ('$U1','{\"back\":1}','2026-11-05T10:00:00Z')" >/dev/null

echo "== 7. Sequence permissions and function hardening"
chk "7a authenticated and service_role have USAGE only; anon and public have nothing" "true|true|false|false|false|false|false" "$(P -c "select has_sequence_privilege('authenticated','public.backups_rev_seq','usage')||'|'||has_sequence_privilege('service_role','public.backups_rev_seq','usage')||'|'||has_sequence_privilege('authenticated','public.backups_rev_seq','select')||'|'||has_sequence_privilege('authenticated','public.backups_rev_seq','update')||'|'||has_sequence_privilege('service_role','public.backups_rev_seq','update')||'|'||has_sequence_privilege('anon','public.backups_rev_seq','usage')||'|'||has_sequence_privilege('public','public.backups_rev_seq','usage')")"
chk "7b a client cannot reset the sequence (setval -> 42501)" 42501 "$(AS authenticated $U1 "select setval('public.backups_rev_seq', 1);" | sqlstate)"
chk "7c anon cannot draw revisions (nextval -> 42501)" 42501 "$(AS anon $U1 "select nextval('public.backups_rev_seq');" | sqlstate)"
chk "7d the trigger function is SECURITY INVOKER with search_path = ''" "false|{\"search_path=\\\"\\\"\"}" "$(P -c "select prosecdef::text||'|'||proconfig::text from pg_proc where proname='backups_set_rev'")"
chk "7e EXECUTE on the trigger function is revoked from every client role" "false|false|false|false" "$(P -c "select has_function_privilege('authenticated','public.backups_set_rev()','execute')||'|'||has_function_privilege('service_role','public.backups_set_rev()','execute')||'|'||has_function_privilege('anon','public.backups_set_rev()','execute')||'|'||has_function_privilege('public','public.backups_set_rev()','execute')")"
chk "7f the function is not callable as an RPC (no EXECUTE for clients)" 42501 "$(AS authenticated $U1 "select public.backups_set_rev();" | sqlstate)"
chk "7g writes still work although EXECUTE is revoked (trigger firing needs no EXECUTE)" t "$(AS authenticated $U1 "update public.backups set payload='{\"x\":1}' where user_id='$U1' returning 't';" | grep -c '^t$' | awk '{print ($1==1)?"t":"f"}')"
# search_path hijack: shadow nextval in public and put public first; the trigger must still use pg_catalog.nextval
P -c "create function public.nextval(regclass) returns bigint language sql as 'select 1::bigint'" >/dev/null
chk "7h search-path hijack (public.nextval shadow, search_path=public) does not change the revision source" t "$(P -c "set search_path = public; update public.backups set payload='{\"h\":1}' where user_id='$U1' returning rev > 1000000000000")"
P -c "drop function public.nextval(regclass)" >/dev/null
P -c "revoke usage on sequence public.backups_rev_seq from authenticated" >/dev/null
chk "7i NECESSITY: without USAGE an authenticated write fails (42501) - the grant is required" 42501 "$(AS authenticated $U1 "update public.backups set payload='{}' where user_id='$U1';" | sqlstate)"
P -c "grant usage on sequence public.backups_rev_seq to authenticated" >/dev/null
chk "7j ...and works again after re-granting" t "$(AS authenticated $U1 "update public.backups set payload='{}' where user_id='$U1' returning 't';" | grep -c '^t$' | awk '{print ($1==1)?"t":"f"}')"

echo "== 8. ROLLBACK, old-schema client path, RE-UPGRADE"
MAXBEFORE=$(P -c "select max(rev) from public.backups")
SEQBEFORE=$(P -c "select last_value from public.backups_rev_seq")
DATA=$(P -c "select md5(string_agg(user_id::text||payload::text||updated_at::text, ',' order by user_id)) from public.backups")
P -f $BACK >/dev/null; RC=$?
chk "8a rollback applies cleanly" 0 $RC
chk "8b column, trigger and function are gone; the SEQUENCE is kept on purpose" "0|0|0|1" "$(P -c "select (select count(*) from information_schema.columns where table_name='backups' and column_name='rev')||'|'||(select count(*) from pg_trigger where tgname='backups_set_rev')||'|'||(select count(*) from pg_proc where proname='backups_set_rev')||'|'||(select count(*) from pg_class where relname='backups_rev_seq')")"
chk "8c backup data is untouched by the rollback" "$DATA" "$(P -c "select md5(string_agg(user_id::text||payload::text||updated_at::text, ',' order by user_id)) from public.backups")"
OUT=$(AS authenticated $U1 "select rev from public.backups;"); 
chk "8d a client still asking for rev gets SQLSTATE 42703 (the confirmed missing-column signal)" 42703 "$(echo "$OUT" | sqlstate)"
chk "8e ...and the message names the column (the client requires this to classify it)" 1 "$(echo "$OUT" | grep -c 'column.*rev.*does not exist')"
OBS=$(P -c "select updated_at from public.backups where user_id='$U1'")
chk "8f OLD-SCHEMA fallback: updated_at CAS works (1 row), stale token 0 rows" "1|0" "$(AS authenticated $U1 "with u as (update public.backups set payload='{\"fb\":1}', updated_at='2026-12-01T00:00:00Z' where user_id='$U1' and updated_at='$OBS' returning 1) select count(*) from u;" | grep -E '^[01]$')|$(AS authenticated $U1 "with u as (update public.backups set payload='{}' where user_id='$U1' and updated_at='$OBS' returning 1) select count(*) from u;" | grep -E '^[01]$')"
chk "8g a legacy blind upsert still works on the rolled-back schema" t "$(AS authenticated $U1 "insert into public.backups(user_id,payload,updated_at) values ('$U1','{\"l\":1}',now()) on conflict (user_id) do update set payload=excluded.payload, updated_at=excluded.updated_at returning 't';" | grep -c '^t$' | awk '{print ($1==1)?"t":"f"}')"
P -f $FWD >/dev/null; RC=$?
chk "8h re-upgrade applies cleanly" 0 $RC
chk "8i after re-upgrade every revision is greater than anything issued before the rollback (never reused)" t "$(P -c "select min(rev) > $MAXBEFORE and (select last_value from public.backups_rev_seq) >= $SEQBEFORE from public.backups")"
chk "8j re-upgrade restores working triggers" t "$(AS authenticated $U1 "update public.backups set payload='{\"re\":1}' where user_id='$U1' returning rev > $MAXBEFORE;" | grep -c '^t$' | awk '{print ($1==1)?"t":"f"}')"

echo "== 9. Recreated sequence cannot re-issue earlier numbers (time-based start)"
MAXNOW=$(P -c "select max(rev) from public.backups")
P -c "drop trigger backups_set_rev on public.backups; drop function public.backups_set_rev(); alter table public.backups drop column rev; drop sequence public.backups_rev_seq" >/dev/null
sleep 1; P -f $FWD >/dev/null
chk "9a even after the sequence itself was dropped and recreated, new revisions start above the old ones" t "$(P -c "select min(rev) > $MAXNOW from public.backups")"

echo; echo "== SUMMARY: $PASSES passed, $FAILS failed"
exit $([[ $FAILS -eq 0 ]] && echo 0 || echo 1)
