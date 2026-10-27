-- Against the NEW body (20261014100000). Run after pr140_stub + migrations.
\set ON_ERROR_STOP on
\set U '11111111-1111-1111-1111-111111111111'
\set V '22222222-2222-2222-2222-222222222222'
-- 1-4 time source: p_now_ms ignored (huge, negative, NULL, default)
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
select public.consume_ai_rate_limit(:'U', 9000000000000000);
select public.consume_ai_rate_limit(:'U', -5);
select public.consume_ai_rate_limit(:'U', null);
select public.consume_ai_rate_limit(:'U');
reset role;
select t.ok(cardinality(minute_stamps) = 4 and (select bool_and(x between t.now_ms() - 5000 and t.now_ms()) from unnest(minute_stamps) x),
  'c1-4 p_now_ms huge/negative/NULL/default ignored; stamps = server time') from public.ai_rate_limits where user_id = :'U';
-- 5,8,9 limit 8/min; denied call does not append; allowed appends exactly one
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
select t.calls(:'U', 8) as a8 \gset
select allowed as a9, retry_after_seconds as r9 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:a8 = 8, 'c5 8 calls allowed in a fresh minute');
select t.ok(not :'a9'::boolean and :r9 between 1 and 60, 'c5/c10 9th denied, retry 1..60');
select t.ok(cardinality(minute_stamps) = 8 and cardinality(hour_stamps) = 8, 'c8/c9 one stamp per allowed call, none for denied') from public.ai_rate_limits where user_id = :'U';
-- 6 minute boundary: 7 stamps 59.0 s old count (8th allowed, 9th denied); 8 stamps exactly >= 60.0 s old do not count
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n - 59000 from generate_series(1,7)), array(select :n - 59000 from generate_series(1,7)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as b1 from public.consume_ai_rate_limit(:'U') \gset
select allowed as b2, retry_after_seconds as rb2 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'b1'::boolean and not :'b2'::boolean, 'c6 stamps < 60 s old count: 7 old + 1 allowed, next denied');
select t.ok(:rb2 between 1 and 2, 'c10 retry = ceil((oldest+60000-now)/1000) ~ 1 s');
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n - 60000 from generate_series(1,8)), array(select :n - 60000 from generate_series(1,8)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as b3 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'b3'::boolean, 'c6 stamps exactly 60.000 s old no longer count (v_now - x < 60000)');
-- 7 hour: 60 stamps within the hour -> denied; 59 -> allowed; 3600000 ms old not counted
select t.now_ms() as n \gset
select t.reset(:'U', '{}', array(select :n - 3599000 + g from generate_series(1,60) g));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as h60, retry_after_seconds as rh from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'h60'::boolean and :rh between 1 and 3600, 'c7 60 stamps in the hour -> denied, retry 1..3600');
select t.now_ms() as n \gset
select t.reset(:'U', '{}', array(select :n - 3599000 + g from generate_series(1,59) g));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as h59 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'h59'::boolean, 'c7 59 stamps in the hour -> 60th allowed');
select t.now_ms() as n \gset
select t.reset(:'U', '{}', array(select :n - 3600000 from generate_series(1,60)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as h0 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'h0'::boolean, 'c7 stamps exactly 3600.000 s old no longer count');
-- 11-14 future rows: small (<= tolerance) counted, large dropped/pruned, multiple offsets, repeated huge p_now_ms
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n + 1000000000 + g from generate_series(1,9) g), array(select :n + 1000000000 + g from generate_series(1,9) g));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as f1 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(:'f1'::boolean, 'c12 9 large-future stamps -> no lockout');
select t.ok(cardinality(minute_stamps) = 1, 'c11 large-future stamps pruned from the row') from public.ai_rate_limits where user_id = :'U';
select t.now_ms() as n \gset
select t.reset(:'U',
  array(select :n - 1000 * g from generate_series(1,7) g) || array[:n + 500, :n + 5000, :n + 3600000, :n + 9000000000000]::bigint[],
  array(select :n - 1000 * g from generate_series(1,7) g) || array[:n + 500, :n + 5000, :n + 3600000, :n + 9000000000000]::bigint[]);
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as f2 from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'f2'::boolean, 'c13 7 real + 1 small-future (+0.5 s, within tolerance) = 8 -> denied; +5 s/+1 h/huge ignored');
select t.ok(cardinality(minute_stamps) = 8, 'c13 multiple offsets: only the 3 beyond-tolerance stamps pruned') from public.ai_rate_limits where user_id = :'U';
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
select t.calls(:'U', 20, 9000000000000, 4000000, false) as fh \gset
reset role;
select t.ok(:fh = 8, 'c14 20 calls with ever larger p_now_ms -> exactly 8 allowed (F-1 closed)');
-- 15 clock step back <= 1 s: recent stamps up to +1 s stay counted (F-140-3 tolerance)
select t.now_ms() as n \gset
select t.reset(:'U', array(select :n + 900 from generate_series(1,8)), array(select :n + 900 from generate_series(1,8)));
set role authenticated; set request.jwt.claim.sub = :'U';
select allowed as cs from public.consume_ai_rate_limit(:'U') \gset
reset role;
select t.ok(not :'cs'::boolean, 'c15 8 stamps +0.9 s (clock stepped back <= 1 s) still counted -> denied');
-- 16-19 auth
\set ON_ERROR_STOP off
set role anon; set request.jwt.claim.sub = :'U';
select public.consume_ai_rate_limit(:'U');
\echo 'expected above: permission denied (c16)'
reset role;
set role authenticated; set request.jwt.claim.sub = :'V';
select public.consume_ai_rate_limit(:'U');
\echo 'expected above: forbidden (c17 foreign user id)'
reset role;
set role authenticated; set request.jwt.claim.sub = '';
select public.consume_ai_rate_limit(:'U');
\echo 'expected above: forbidden (c18 auth.uid() NULL)'
reset role;
set role service_role; set request.jwt.claim.sub = '';
select public.consume_ai_rate_limit(:'U');
\echo 'expected above: forbidden (c19 service_role without uid)'
reset role;
\set ON_ERROR_STOP on
select t.ok(not has_function_privilege('anon', 'public.consume_ai_rate_limit(uuid,bigint)', 'execute'), 'c16 anon has no EXECUTE');
select t.ok(has_function_privilege('authenticated', 'public.consume_ai_rate_limit(uuid,bigint)', 'execute'), 'c20 authenticated EXECUTE');
select t.ok(has_function_privilege('service_role', 'public.consume_ai_rate_limit(uuid,bigint)', 'execute'), 'c20 service_role EXECUTE (as live)');
select t.ok(not has_function_privilege('public', 'public.consume_ai_rate_limit(uuid,bigint)', 'execute'), 'c20 PUBLIC has no EXECUTE');
-- 20-21 definition
select array_to_string(proacl, ',') as acl, prosecdef, array_to_string(proconfig, ',') as cfg, pg_get_function_result(oid) as res, pg_get_userbyid(proowner) as own
from pg_proc where proname = 'consume_ai_rate_limit';
select t.ok(count(*) = 1, 'c21 exactly one overload') from pg_proc where proname = 'consume_ai_rate_limit';
select t.ok(prosecdef and proconfig = '{search_path=public}' and pg_get_function_result(oid) = 'TABLE(allowed boolean, retry_after_seconds integer)'
  and pg_get_function_identity_arguments(oid) = 'p_user_id uuid, p_now_ms bigint' and pg_get_userbyid(proowner) = 'postgres',
  'c20/21 signature, return type, SECURITY DEFINER, search_path, owner unchanged') from pg_proc where proname = 'consume_ai_rate_limit';
