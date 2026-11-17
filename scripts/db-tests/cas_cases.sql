-- Functional CAS cases against the REAL backups table + RLS. Every statement is the SQL PostgREST
-- would run for the corresponding request (PATCH ...?user_id=eq.U&updated_at=eq.T with
-- Prefer: return=representation  ==  UPDATE ... WHERE user_id = U AND updated_at = T RETURNING ...).
\set ON_ERROR_STOP off
\set VERBOSITY verbose
\set U '11111111-1111-1111-1111-111111111111'
\set V '22222222-2222-2222-2222-222222222222'
\set GHOST '33333333-3333-3333-3333-333333333333'
insert into auth.users values (:'U'), (:'V');

-- helper: act as an authenticated PostgREST request for user :sub
create function t.as_user(sub text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', sub, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', sub, false);
end $$;
grant execute on function t.as_user(text) to public;

\echo '--- 1. INSERT when no row exists (POST, return=representation)'
set role authenticated; select t.as_user(:'U');
insert into public.backups (user_id, payload, updated_at) values (:'U', '{"shifts":[1]}', '2026-11-17T10:00:00.000Z') returning to_json(updated_at) as token \gset
reset role;
select t.ok(:'token' = '"2026-11-17T10:00:00+00:00"', 'c1 insert returns the row; server token serialised as ' || :'token');

\echo '--- 2. CAS hit: exactly one row, server keeps the client-supplied updated_at (no trigger)'
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set payload = '{"shifts":[1,2]}', updated_at = '2026-11-17T10:00:01.000Z'
  where user_id = :'U' and updated_at = '2026-11-17T10:00:00+00:00' returning to_json(updated_at) as tok)
select count(*) as n, min(tok::text) as tok from u \gset
reset role;
select t.ok(:n = 1 and :'tok' = '"2026-11-17T10:00:01+00:00"', 'c2 update with exact observed token returns exactly 1 row; updated_at is the client value (' || :'tok' || ')');

\echo '--- 3. CAS miss: stale token -> zero rows, row unchanged'
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set payload = '{"x":"stale"}', updated_at = '2026-11-17T10:00:09.000Z'
  where user_id = :'U' and updated_at = '2026-11-17T10:00:00+00:00' returning 1) select count(*) as n from u \gset
reset role;
select t.ok(:n = 0, 'c3 stale observed token matches ZERO rows (no error)');
select t.ok(payload = '{"shifts":[1,2]}'::jsonb, 'c3 row unchanged after the stale attempt') from public.backups where user_id = :'U';

\echo '--- 4. Timestamp precision & serialisation'
reset role;
update public.backups set updated_at = '2026-10-27 19:28:52.738123+00' where user_id = :'U';
select to_json(updated_at)::text as micro from public.backups where user_id = :'U' \gset
select t.ok(:'micro' = '"2026-10-27T19:28:52.738123+00:00"', 'c4a microseconds are serialised in full: ' || :'micro');
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set updated_at = updated_at where user_id = :'U' and updated_at = '2026-10-27T19:28:52.738+00:00' returning 1) select count(*) as n from u \gset
reset role;
select t.ok(:n = 0, 'c4b a token TRUNCATED to milliseconds does NOT match a microsecond row -> tokens must stay exact strings');
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set updated_at = updated_at where user_id = :'U' and updated_at = '2026-10-27T19:28:52.738123+00:00' returning 1) select count(*) as n from u \gset
with u as (update public.backups set updated_at = updated_at where user_id = :'U' and updated_at = '2026-10-27T19:28:52.738123Z' returning 1) select count(*) as nz from u \gset
reset role;
select t.ok(:n = 1 and :nz = 1, 'c4c exact micro token matches; +00:00 and Z spellings of the same instant both match');
-- the app writes millisecond ISO strings: they round-trip exactly
update public.backups set updated_at = '2026-11-17T12:34:56.789Z' where user_id = :'U';
select to_json(updated_at)::text as msj from public.backups \gset
select t.ok(:'msj' = '"2026-11-17T12:34:56.789+00:00"', 'c4d app-style ms ISO value round-trips as ' || :'msj');
update public.backups set updated_at = '2026-11-17T12:34:56.700Z' where user_id = :'U';
select to_json(updated_at)::text as trimmed from public.backups \gset
select t.ok(:'trimmed' = '"2026-11-17T12:34:56.7+00:00"', 'c4e trailing zeros are trimmed by the server (' || :'trimmed' || ') - parseable and instant-equal');
set timezone = 'Europe/Berlin';
select to_json(updated_at)::text as berlin from public.backups \gset
reset timezone;
select t.ok(:'berlin' like '%+01:00"' or :'berlin' like '%+02:00"', 'c4f with a non-UTC session timezone the OFFSET changes (' || :'berlin' || ') but the instant (and therefore the equality filter) does not');
set role authenticated; select t.as_user(:'U'); set timezone = 'Europe/Berlin';
with u as (update public.backups set updated_at = updated_at where user_id = :'U' and updated_at = '2026-11-17T12:34:56.700Z' returning 1) select count(*) as n from u \gset
reset timezone; reset role;
select t.ok(:n = 1, 'c4g the filter matches regardless of the session timezone');

\echo '--- 5. RLS / isolation'
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set payload = '{"hack":1}' where user_id = :'V' returning 1) select count(*) as n from u \gset
reset role;
select t.ok(:n = 0, 'c5a UPDATE of another account row matches ZERO rows (RLS filters; no error)');
set role authenticated; select t.as_user(:'U');
do $$ begin insert into public.backups (user_id, payload, updated_at) values ('22222222-2222-2222-2222-222222222222', '{}', now()); perform t.ok(false, 'c5b INSERT for another account: expected SQLSTATE 42501, got success');
exception when others then perform t.ok(sqlstate = '42501', 'c5b INSERT for another account: SQLSTATE ' || sqlstate || ' (' || sqlerrm || ')'); end $$;
reset role;

set role authenticated; select t.as_user(:'U');
select count(*) as n from public.backups \gset
reset role;
select t.ok(:n = 1, 'c5c authenticated user sees only the own row');
set role anon; 
do $$ begin perform count(*) from public.backups; perform t.ok(false, 'c5d anon SELECT: expected SQLSTATE 42501, got success');
exception when others then perform t.ok(sqlstate = '42501', 'c5d anon SELECT: SQLSTATE ' || sqlstate || ' (' || sqlerrm || ')'); end $$;
reset role;


\echo '--- 6. INSERT when the row already exists -> unique violation'
set role authenticated; select t.as_user(:'U');
do $$ begin insert into public.backups (user_id, payload, updated_at) values ('11111111-1111-1111-1111-111111111111', '{}', now()); perform t.ok(false, 'c6 duplicate INSERT: expected SQLSTATE 23505, got success');
exception when others then perform t.ok(sqlstate = '23505', 'c6 duplicate INSERT: SQLSTATE ' || sqlstate || ' (' || sqlerrm || ')'); end $$;
reset role;


\echo '--- 7. INSERT for an account that does not exist (RLS passes, FK fails) -> 23503'
set role authenticated; select t.as_user(:'GHOST');
do $$ begin insert into public.backups (user_id, payload, updated_at) values ('33333333-3333-3333-3333-333333333333', '{}', now()); perform t.ok(false, 'c7 INSERT for a nonexistent account: expected SQLSTATE 23503, got success');
exception when others then perform t.ok(sqlstate = '23503', 'c7 INSERT for a nonexistent account: SQLSTATE ' || sqlstate || ' (' || sqlerrm || ')'); end $$;
reset role;


\echo '--- 8. Account deleted while a client holds an observed token'
select updated_at::text as obs from public.backups where user_id = :'V' \gset
insert into public.backups (user_id, payload) values (:'V', '{}');
select to_json(updated_at)::text as vtok from public.backups where user_id = :'V' \gset
delete from auth.users where id = :'V';
select t.ok(not exists (select 1 from public.backups where user_id = :'V'), 'c8a ON DELETE CASCADE removed the backup row with the account');
set role authenticated; select t.as_user(:'V');
with u as (update public.backups set payload = '{"zombie":1}' where user_id = :'V' and updated_at = trim(both '"' from :'vtok')::timestamptz returning 1) select count(*) as n from u \gset
reset role;
select t.ok(:n = 0, 'c8b CAS update after the account was deleted matches zero rows');
set role authenticated; select t.as_user(:'V');
do $$ begin insert into public.backups (user_id, payload, updated_at) values ('22222222-2222-2222-2222-222222222222', '{}', now()); perform t.ok(false, 'c8c INSERT after account deletion: expected SQLSTATE 23503, got success');
exception when others then perform t.ok(sqlstate = '23503', 'c8c INSERT after account deletion: SQLSTATE ' || sqlstate || ' (' || sqlerrm || ')'); end $$;
reset role;

insert into auth.users values (:'V');

\echo '--- 9. LIMITS: writers that are NOT protected by the client CAS'
-- 9a legacy/blind authenticated PATCH without an updated_at condition (what an old client or a script does)
set role authenticated; select t.as_user(:'U');
with u as (update public.backups set payload = '{"blind":"overwrite"}', updated_at = '2026-11-17T13:00:00Z' where user_id = :'U' returning 1) select count(*) as n from u \gset
reset role;
select t.ok(:n = 1, 'c9a LIMIT: an authenticated blind PATCH (no CAS condition) succeeds - nothing server-side forces the condition');
-- 9b payload change WITHOUT bumping updated_at: the token cannot detect it (no trigger)
set role authenticated; select t.as_user(:'U');
update public.backups set payload = '{"silent":"change"}' where user_id = :'U';
select to_json(updated_at)::text as same_tok from public.backups \gset
reset role;
select t.ok(:'same_tok' = '"2026-11-17T13:00:00+00:00"', 'c9b LIMIT: a payload change that does not touch updated_at leaves the token UNCHANGED - a CAS on the token would not notice it (no server trigger/version counter)');
-- 9c ABA: a writer re-using an old token value
set role authenticated; select t.as_user(:'U');
update public.backups set payload = '{"aba":1}', updated_at = '2026-11-17T13:00:00Z' where user_id = :'U';
reset role;
select t.ok((select to_json(updated_at)::text = '"2026-11-17T13:00:00+00:00"' from public.backups where user_id = :'U'), 'c9c LIMIT: updated_at is client-controlled, so an old token value can be re-used (ABA); only a server-maintained version would prevent it');
-- 9d service_role bypasses RLS entirely
set role service_role;
update public.backups set payload = '{"service":"role"}' where user_id = :'U';
reset role;
select t.ok((select payload = '{"service":"role"}'::jsonb from public.backups where user_id = :'U'), 'c9d LIMIT: service_role bypasses RLS and any client-side CAS');

\echo '--- RESULT'
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
