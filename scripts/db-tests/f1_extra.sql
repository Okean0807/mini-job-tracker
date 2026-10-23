-- F-1 additional cases (t604) against the NEW body. Isolated local PostgreSQL only.
-- Run after pr140_stub.sql + 192406 + 192446 + the new function body.
\set ON_ERROR_STOP on
\set U '11111111-1111-1111-1111-111111111111'
\set V '22222222-2222-2222-2222-222222222222'
-- e1 future tolerance boundary: +1000 ms counted, +1001 ms dropped (8 stamps each)
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n + 1000 + 400 from generate_series(1,8)), array(select :n + 1000 + 400 from generate_series(1,8)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as e1a from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'e1a'::boolean, 'e1 8 stamps ~+1.4 s (beyond 1 s tolerance) dropped -> allowed');
select t.ok(cardinality(minute_stamps) = 1, 'e1 beyond-tolerance stamps pruned') from public.ai_rate_limits where user_id = :'U';
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n + 600 from generate_series(1,8)), array(select :n + 600 from generate_series(1,8)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as e1b from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'e1b'::boolean, 'e1 8 stamps +0.6 s (within tolerance) counted -> denied');
-- e2 minute boundary just inside: 8 stamps 59.5 s old -> denied, retry 1
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n - 59500 from generate_series(1,8)), array(select :n - 59500 from generate_series(1,8)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as e2, retry_after_seconds as re2 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'e2'::boolean and :re2 = 1, 'e2 8 stamps 59.5 s old still count -> denied, retry 1 s');
-- e3 hour denial appends nothing and keeps minute window intact
select t.now_ms() as n \gset
select t.reset(:'U', '{}', array(select :n - 3000000 + g from generate_series(1,60) g));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as e3 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'e3'::boolean, 'e3 hour limit reached -> denied');
select t.ok(cardinality(hour_stamps) = 60 and cardinality(minute_stamps) = 0, 'e3 denied call appends nothing') from public.ai_rate_limits where user_id = :'U';
-- e4 per-user isolation: V exhausting its minute does not affect U
select t.reset(:'U'); select t.reset(:'V');
set role authenticated; set request.jwt.claim.sub = :'V';
select t.calls(:'V', 9) as v9 \gset
set request.jwt.claim.sub = :'U';
select allowed as e4 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:v9 = 8 and :'e4'::boolean, 'e4 per-user rows: V limited at 8, U unaffected');
-- e5 past p_now_ms (bypass attempt with an old clock) never writes past stamps
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
select t.calls(:'U', 12, 1000, -1, false) as e5 \gset
reset role;
select t.ok(:e5 = 8, 'e5 12 calls with tiny/decreasing p_now_ms -> exactly 8 allowed');
select t.ok((select bool_and(x >= t.now_ms() - 10000) from unnest(minute_stamps) x), 'e5 stamps are server time, not p_now_ms') from public.ai_rate_limits where user_id = :'U';
-- e7 repeated calls over the hour: 8/min cap still applies after many denied calls
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
select t.calls(:'U', 50) as e7 \gset
reset role;
select t.ok(:e7 = 8, 'e7 50 consecutive calls -> exactly 8 allowed');
select t.ok(cardinality(minute_stamps) = 8 and cardinality(hour_stamps) = 8, 'e7 42 denied calls stored nothing') from public.ai_rate_limits where user_id = :'U';
-- e8 (derived Q10) direct table write/reset by API roles is impossible
select t.ok(not has_table_privilege('authenticated', 'public.ai_rate_limits', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_rate_limits', 'DELETE')
  and not has_table_privilege('authenticated', 'public.ai_rate_limits', 'INSERT')
  and not has_table_privilege('anon', 'public.ai_rate_limits', 'UPDATE'),
  'e8 authenticated/anon have no INSERT/UPDATE/DELETE on ai_rate_limits');
\set ON_ERROR_STOP off
set role authenticated; set request.jwt.claim.sub = :'U';
update public.ai_rate_limits set minute_stamps = '{}' where user_id = :'U';
\echo 'expected above: permission denied for table ai_rate_limits (e8)'
reset role;
\set ON_ERROR_STOP on
select t.ok(cardinality(minute_stamps) = 8, 'e8 row unchanged after denied direct update') from public.ai_rate_limits where user_id = :'U';
-- e9 (derived Q12) search_path hijack: a shadow auth.uid()/unnest in a caller schema has no effect
create schema evil;
create function evil.unnest(anyarray) returns setof anyelement language sql as $$ select null::anyelement where false $$;
grant usage on schema evil to authenticated;
grant execute on function evil.unnest(anyarray) to authenticated;
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U'; set search_path = evil, public, pg_catalog;
select t.calls(:'U', 10) as e9 \gset
reset role; reset search_path;
select t.ok(:e9 = 8, 'e9 caller search_path with shadow functions -> still exactly 8 allowed');
drop schema evil cascade;
