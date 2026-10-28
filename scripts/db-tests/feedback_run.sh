#!/usr/bin/env bash
# Behavioural tests of the Feedback C2 migration DRAFT. NOT part of CI. NOT a Supabase test.
# Runs ONLY against an isolated, TEMPORARY local PostgreSQL reached through a unix socket
# (PGHOST must be a directory; TCP hosts are refused). It uses a stub of Supabase's auth schema
# (scripts/db-tests/feedback_stub.sql), so a pass here proves the SQL logic, not Supabase compatibility.
# Usage: PGHOST=/tmp/pgfb/sock PGPORT=55418 scripts/db-tests/feedback_run.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
: "${PGHOST:?set PGHOST to the local socket directory}"
[[ -d "$PGHOST" ]] || { echo "refusing: PGHOST must be a local socket directory"; exit 2; }
export PGUSER=postgres
D=scripts/db-tests
MIG=supabase/pending/20261028120000_feedback.sql
ROLLBACK=supabase/pending/rollback/20261028120000_feedback.rollback.sql
DB=feedback_$$; DB2=${DB}_owner; DB3=${DB}_force
A=aaaaaaaa-0000-4000-8000-000000000001; B=bbbbbbbb-0000-4000-8000-000000000002; C=cccccccc-0000-4000-8000-000000000003
FAILS=0
cleanup() { for d in "$DB" "$DB2" "$DB3"; do psql -qX -d postgres -c "drop database if exists $d" >/dev/null 2>&1; done
            psql -qX -d postgres -c "drop role if exists fb_owner" >/dev/null 2>&1; rm -f /tmp/fb_par_$$_*; }
trap cleanup EXIT
psql -qX -d postgres -c "drop role if exists fb_owner" >/dev/null 2>&1

q() { psql -qXAt -d "$1" -c "$2" 2>&1; }          # plain query as superuser
# run a statement as an API role with given JWT claims, like PostgREST (role switch + claims GUC); $5=commit|rollback
api() { psql -qXAt -d "$1" <<SQL 2>&1
begin;
set local role $2;
set local request.jwt.claims = '$3';
$4;
${5:-rollback};
SQL
}
ok()  { if [[ "$2" == "$3" ]]; then echo "PASS $1"; else echo "FAIL $1 (got: $2 | want: $3)"; FAILS=$((FAILS+1)); fi; }
has() { if grep -q -- "$3" <<<"$2"; then echo "PASS $1"; else echo "FAIL $1 (got: $2)"; FAILS=$((FAILS+1)); fi; }
CA="{\"sub\":\"$A\",\"role\":\"authenticated\"}"; CB="{\"sub\":\"$B\",\"role\":\"authenticated\"}"
CANON="{\"sub\":\"$C\",\"role\":\"authenticated\",\"is_anonymous\":true}"
call() { echo "select status from public.submit_feedback('${1}'::uuid,'${2:-bug}','${3:-Es geht nicht}',${4:-null}::smallint,'1.0','de','/einstellungen')"; }

suite() { # $1 = database name (migration already applied)
  local db=$1
  echo "-- access: anon / no token / authenticated"
  has "anon cannot execute submit_feedback" "$(api $db anon '{}' "$(call 11111111-1111-4111-8111-111111111111)")" "permission denied"
  has "anon cannot read feedback" "$(api $db anon '{}' "select * from public.feedback")" "permission denied"
  has "authenticated cannot read feedback" "$(api $db authenticated "$CA" "select * from public.feedback")" "permission denied"
  has "authenticated cannot insert feedback directly" "$(api $db authenticated "$CA" "insert into public.feedback(user_id,submission_id,kind,message,app_version,lang,route) values ('$A',gen_random_uuid(),'bug','abcdef','1','de','/')")" "permission denied"
  has "authenticated cannot update feedback" "$(api $db authenticated "$CA" "update public.feedback set message='x'")" "permission denied"
  has "authenticated cannot delete feedback" "$(api $db authenticated "$CA" "delete from public.feedback")" "permission denied"
  has "authenticated cannot read rate limits" "$(api $db authenticated "$CA" "select * from public.feedback_rate_limits")" "permission denied"
  has "authenticated cannot write rate limits" "$(api $db authenticated "$CA" "insert into public.feedback_rate_limits(user_id) values ('$A')")" "permission denied"
  ok "no token (authenticated role without sub) -> unauthenticated" "$(api $db authenticated '{}' "$(call 11111111-1111-4111-8111-111111111111)" | head -1)" "unauthenticated"
  echo "-- identity: user A, user B, anonymous JWT"
  ok "user A creates" "$(api $db authenticated "$CA" "$(call 22222222-2222-4222-8222-222222222222)" commit | head -1)" "created"
  ok "the row's author is A (taken from the JWT subject)" "$(q $db "select user_id from public.feedback")" "$A"
  has "no user-id parameter: passing one fails" "$(api $db authenticated "$CA" "select * from public.submit_feedback(p_user_id => '$B'::uuid, p_submission_id => gen_random_uuid(), p_kind => 'bug', p_message => 'abcdef', p_rating => null::smallint, p_app_version => '1', p_lang => 'de', p_route => '/')")" "does not exist"
  ok "user B with the same submission id is not a duplicate" "$(api $db authenticated "$CB" "$(call 22222222-2222-4222-8222-222222222222)" commit | head -1)" "created"
  ok "one row per user" "$(q $db "select count(*)||':'||count(distinct user_id) from public.feedback")" "2:2"
  ok "anonymous Supabase JWT (is_anonymous=true) -> forbidden" "$(api $db authenticated "$CANON" "$(call 33333333-3333-4333-8333-333333333333)" | head -1)" "forbidden"
  ok "no row for the anonymous user" "$(q $db "select count(*) from public.feedback where user_id='$C'")" "0"
  ok "is_anonymous=false passes" "$(api $db authenticated "{\"sub\":\"$C\",\"role\":\"authenticated\",\"is_anonymous\":false}" "$(call 44444444-4444-4444-8444-444444444444)" commit | head -1)" "created"
  echo "-- function properties"
  has "SECURITY DEFINER + pinned search_path (pg_temp last)" "$(q $db "select prosecdef::text||' '||array_to_string(proconfig,',') from pg_proc where proname='submit_feedback'")" "true search_path=public, pg_temp"
  ok "EXECUTE: authenticated yes; anon and PUBLIC no" "$(q $db "select has_function_privilege('authenticated', p.oid,'execute')::text||has_function_privilege('anon', p.oid,'execute')::text||has_function_privilege('public', p.oid,'execute')::text from pg_proc p where p.proname='submit_feedback'")" "truefalsefalse"
  ok "no table privileges for anon/authenticated/PUBLIC" "$(q $db "select count(*) from information_schema.role_table_grants where table_name in ('feedback','feedback_rate_limits') and grantee in ('anon','authenticated','PUBLIC')")" "0"
  ok "RLS enabled, no policies, not forced" "$(q $db "select (select count(*) from pg_policies where tablename like 'feedback%')||':'||bool_and(relrowsecurity)||':'||bool_or(relforcerowsecurity) from pg_class where relname in ('feedback','feedback_rate_limits')")" "0:true:false"
  echo "-- validation: expected conditions return a status, never SQL text"
  local bad=0 v out
  for v in "null::uuid,'bug','abcdef',null::smallint,'1','de','/'" "gen_random_uuid(),null,'abcdef',null::smallint,'1','de','/'" "gen_random_uuid(),'spam','abcdef',null::smallint,'1','de','/'" "gen_random_uuid(),'bug','ab',null::smallint,'1','de','/'" "gen_random_uuid(),'bug',repeat('x',2001),null::smallint,'1','de','/'" "gen_random_uuid(),'bug','abcdef',3::smallint,'1','de','/'" "gen_random_uuid(),'rating','',6::smallint,'1','de','/'" "gen_random_uuid(),'rating','',0::smallint,'1','de','/'" "gen_random_uuid(),'rating','',null::smallint,'1','de','/'" "gen_random_uuid(),'bug','abcdef',null::smallint,'1','xx','/'" "gen_random_uuid(),'bug','abcdef',null::smallint,'','de','/'" "gen_random_uuid(),'bug','abcdef',null::smallint,repeat('v',33),'de','/'" "gen_random_uuid(),'bug','abcdef',null::smallint,'1','de',''" "gen_random_uuid(),'bug','abcdef',null::smallint,'1','de',repeat('r',65)" "gen_random_uuid(),'bug',null,null::smallint,'1','de','/'" "gen_random_uuid(),'bug','abcdef',null::smallint,null,'de','/'"; do
    out=$(api $db authenticated "$CA" "select status from public.submit_feedback($v)" | head -1)
    [[ "$out" == "invalid" ]] || { echo "FAIL expected 'invalid', got: $out :: $v"; bad=1; FAILS=$((FAILS+1)); }
  done; [[ $bad == 0 ]] && echo "PASS 16 invalid inputs (kind, text, rating, language, version, route, nulls) all return 'invalid'"
  ok "rating without text is valid" "$(api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'rating','',5::smallint,'1.0','en','/')" | head -1)" "created"
  ok "exactly 2000 characters is valid" "$(api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea',repeat('x',2000),null::smallint,'1.0','en','/')" | head -1)" "created"
  echo "-- idempotency and limits (per user)"
  q $db "truncate public.feedback, public.feedback_rate_limits" >/dev/null
  local sid=55555555-5555-4555-8555-555555555555
  ok "first submission" "$(api $db authenticated "$CA" "$(call $sid)" commit | head -1)" "created"
  ok "same submission id again -> duplicate" "$(api $db authenticated "$CA" "$(call $sid)" commit | head -1)" "duplicate"
  ok "no second row and one quota unit used" "$(q $db "select (select count(*) from public.feedback)||':'||(select cardinality(hour_stamps) from public.feedback_rate_limits where user_id='$A')")" "1:1"
  for i in 1 2 3 4; do api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea','Idee $i',null::smallint,'1','de','/')" commit >/dev/null; done
  ok "A: 6th within the hour -> rate_limited with retry-after" "$(api $db authenticated "$CA" "select status||':'||(retry_after_seconds between 1 and 3600) from public.submit_feedback(gen_random_uuid(),'idea','sechs',null::smallint,'1','de','/')" | head -1)" "rate_limited:true"
  ok "limited request stored nothing" "$(q $db "select count(*) from public.feedback where user_id='$A'")" "5"
  ok "B unaffected while A is limited" "$(api $db authenticated "$CB" "select status from public.submit_feedback(gen_random_uuid(),'idea','B darf',null::smallint,'1','de','/')" commit | head -1)" "created"
  ok "retry of a stored submission still succeeds while limited" "$(api $db authenticated "$CA" "$(call $sid)" | head -1)" "duplicate"
  ok "AI limiter table untouched (quotas are not mixed)" "$(q $db "select count(*) from public.ai_rate_limits")" "0"
  q $db "update public.feedback_rate_limits set hour_stamps = array(select (floor(extract(epoch from clock_timestamp())*1000)::bigint - 3700000) from generate_series(1,5)) where user_id='$A'" >/dev/null
  ok "stamps older than an hour expire" "$(api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea','nach einer Stunde',null::smallint,'1','de','/')" commit | head -1)" "created"
  q $db "update public.feedback_rate_limits set hour_stamps='{}', day_stamps = array(select (floor(extract(epoch from clock_timestamp())*1000)::bigint - 4000000) from generate_series(1,20)) where user_id='$A'" >/dev/null
  ok "20 per day -> rate_limited" "$(api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea','Tageslimit',null::smallint,'1','de','/')" | head -1)" "rate_limited"
  q $db "update public.feedback_rate_limits set hour_stamps = array(select (floor(extract(epoch from clock_timestamp())*1000)::bigint + 9000000) from generate_series(1,5)), day_stamps='{}' where user_id='$A'" >/dev/null
  ok "future stamps do not lock a user" "$(api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea','Zukunft',null::smallint,'1','de','/')" commit | head -1)" "created"
  echo "-- concurrency: 12 parallel calls from one user (limit 5/hour) and 10 parallel with the SAME submission id"
  q $db "truncate public.feedback, public.feedback_rate_limits" >/dev/null
  for i in $(seq 1 12); do ( api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'idea','par $i',null::smallint,'1','de','/')" commit | head -1 > /tmp/fb_par_$$_$i ) & done; wait
  ok "exactly 5 created, 5 stored" "$(cat /tmp/fb_par_$$_* | grep -c '^created$'):$(q $db 'select count(*) from public.feedback')" "5:5"; rm -f /tmp/fb_par_$$_*
  q $db "truncate public.feedback, public.feedback_rate_limits" >/dev/null
  for i in $(seq 1 10); do ( api $db authenticated "$CB" "$(call 66666666-6666-4666-8666-666666666666)" commit | head -1 > /tmp/fb_par_$$_$i ) & done; wait
  ok "same submission id x10: one created, nine duplicates, one row" "$(grep -l '^created$' /tmp/fb_par_$$_* | wc -l):$(cat /tmp/fb_par_$$_* | grep -c '^duplicate$'):$(q $db 'select count(*) from public.feedback')" "1:9:1"; rm -f /tmp/fb_par_$$_*
  echo "-- account deletion"
  api $db authenticated "$CA" "select status from public.submit_feedback(gen_random_uuid(),'bug','von A',null::smallint,'1','de','/')" commit >/dev/null
  q $db "delete from auth.users where id='$A'" >/dev/null
  ok "A's feedback and limiter row are deleted with the account; B's stay" "$(q $db "select (select count(*) from public.feedback where user_id='$A')||':'||(select count(*) from public.feedback_rate_limits where user_id='$A')||':'||(select count(*) from public.feedback where user_id='$B')")" "0:0:1"
}

echo "== A. superuser owner"
psql -qX -d postgres -c "create database $DB" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -d $DB -f $D/feedback_stub.sql >/dev/null && psql -qX -v ON_ERROR_STOP=1 -d $DB -f $MIG >/dev/null || { echo "SETUP FAILED"; exit 1; }
suite $DB

echo "== B. owner WITHOUT superuser and WITHOUT BYPASSRLS (RLS is not forced, so none is needed)"
psql -qX -d postgres -c "create role fb_owner login nosuperuser nobypassrls" >/dev/null
psql -qX -d postgres -c "create database $DB2" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -d $DB2 -f $D/feedback_stub.sql >/dev/null
psql -qX -d $DB2 -c "grant create, usage on schema public to fb_owner; grant usage on schema auth to fb_owner; grant references, select on auth.users to fb_owner; alter default privileges for role fb_owner in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role fb_owner in schema public grant execute on functions to anon, authenticated, service_role" >/dev/null
PGUSER=fb_owner psql -qX -v ON_ERROR_STOP=1 -d $DB2 -f $MIG >/dev/null || { echo "FAIL migration as plain owner"; FAILS=$((FAILS+1)); }
ok "function owner is neither superuser nor BYPASSRLS" "$(q $DB2 "select (not rolsuper and not rolbypassrls)::text from pg_roles r join pg_proc p on p.proowner=r.oid where p.proname='submit_feedback'")" "true"
suite $DB2

echo "== C. regression demo: FORCE ROW LEVEL SECURITY would break that owner (why the draft does not use it)"
psql -qX -d postgres -c "create database $DB3" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -d $DB3 -f $D/feedback_stub.sql >/dev/null
psql -qX -d $DB3 -c "grant create, usage on schema public to fb_owner; grant usage on schema auth to fb_owner; grant references, select on auth.users to fb_owner; alter default privileges for role fb_owner in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role fb_owner in schema public grant execute on functions to anon, authenticated, service_role" >/dev/null
PGUSER=fb_owner psql -qX -v ON_ERROR_STOP=1 -d $DB3 -f $MIG >/dev/null
q $DB3 "alter table public.feedback_rate_limits force row level security; alter table public.feedback force row level security" >/dev/null
has "forced variant fails for a non-BYPASSRLS owner" "$(api $DB3 authenticated "$CA" "$(call 77777777-7777-4777-8777-777777777777)")" "row-level security policy"

echo "== D. rollback"
q $DB "select 1" >/dev/null
psql -qX -v ON_ERROR_STOP=1 -d $DB -f $ROLLBACK >/dev/null
ok "rollback removes tables and function" "$(q $DB "select (to_regclass('public.feedback') is null)::text||(to_regclass('public.feedback_rate_limits') is null)::text||(select count(*) from pg_proc where proname='submit_feedback')")" "truetrue0"
psql -qX -v ON_ERROR_STOP=1 -d $DB -f $MIG >/dev/null
ok "the migration can be re-applied after a rollback" "$(q $DB "select (to_regclass('public.feedback') is not null)::text")" "true"
psql -qX -v ON_ERROR_STOP=1 -d $DB -f $MIG >/dev/null
ok "applying the migration twice is harmless (idempotent objects)" "$(q $DB "select count(*) from pg_proc where proname='submit_feedback'")" "1"

echo; echo "failures: $FAILS"
[[ $FAILS -eq 0 ]] && echo "ALL FEEDBACK DB TESTS PASSED (temporary local PostgreSQL with a stub of Supabase's auth schema - NOT Supabase)"
exit $((FAILS>0))
