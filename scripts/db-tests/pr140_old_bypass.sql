-- Against the OLD body (20260930192406): demonstrates F-1 (caller-controlled p_now_ms).
\set ON_ERROR_STOP on
\set U '11111111-1111-1111-1111-111111111111'
select t.reset(:'U');
set role authenticated; set request.jwt.claim.sub = :'U';
-- 8 normal calls fill the minute window; the 9th normal call is denied.
select t.calls(:'U', 8) as normal_allowed \gset
select t.ok(:normal_allowed = 8, 'old: 8 normal calls allowed');
select t.ok(not allowed, 'old: 9th normal call denied') from public.consume_ai_rate_limit(:'U');
-- Bypass: each call with an ever larger p_now_ms purges all earlier stamps.
select t.calls(:'U', 20, 9000000000000, 4000000, false) as bypass_allowed \gset
select t.ok(:bypass_allowed = 20, 'old: F-1 reproduced - 20/20 extra calls allowed via p_now_ms');
reset role;
