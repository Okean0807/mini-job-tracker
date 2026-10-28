\set ON_ERROR_STOP on
\pset tuples_only on
-- Structure / access model
select t.ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.feedback'::regclass), 'feedback: RLS enabled + forced');
select t.ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.feedback_rate_limits'::regclass), 'rate limits: RLS enabled + forced');
select t.ok((select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in ('feedback', 'feedback_rate_limits')), 'no policies on either table');
select t.ok((select prosecdef from pg_proc where oid = 'public.submit_feedback(uuid,text,text,smallint,text,text,text,text)'::regprocedure), 'submit_feedback is SECURITY DEFINER');
begin;
select t.denied('select * from public.feedback', 'anon', 'anon cannot read feedback');
select t.denied('select * from public.feedback', 'authenticated', 'authenticated cannot read feedback');
select t.denied($$insert into public.feedback(submission_id, kind, message) values (gen_random_uuid(), 'bug', 'abcdef')$$, 'authenticated', 'authenticated cannot insert feedback');
select t.denied($$update public.feedback set message = 'x'$$, 'authenticated', 'authenticated cannot update feedback');
select t.denied($$delete from public.feedback$$, 'anon', 'anon cannot delete feedback');
select t.denied('select * from public.feedback_rate_limits', 'authenticated', 'authenticated cannot read rate limits');
select t.denied($$select * from public.submit_feedback(gen_random_uuid(), 'bug', 'abcdef', null, '1.0', 'de', '/einstellungen', 'k')$$, 'anon', 'anon cannot call submit_feedback');
select t.denied($$select * from public.submit_feedback(gen_random_uuid(), 'bug', 'abcdef', null, '1.0', 'de', '/einstellungen', 'k')$$, 'authenticated', 'authenticated cannot call submit_feedback');
rollback;

-- Behaviour as service_role
set role service_role;
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-000000000001', 'bug', 'Button tut nichts', null, '1.0', 'de', '/einstellungen', 'client-a')) = 'created', 'bug stored -> created');
select t.ok((select count(*) = 1 and bool_and(kind = 'bug' and rating is null and message = 'Button tut nichts' and app_version = '1.0' and lang = 'de' and route = '/einstellungen') from public.feedback), 'stored row has exactly the submitted fields');
select t.ok((select count(*) = 0 from information_schema.columns where table_name = 'feedback' and column_name in ('user_id', 'ip', 'email', 'payload', 'data')), 'no user/ip/email/payload columns');
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-000000000001', 'bug', 'Button tut nichts', null, '1.0', 'de', '/einstellungen', 'client-a')) = 'duplicate', 'same submission id -> duplicate');
select t.ok((select count(*) = 1 from public.feedback), 'duplicate did not create a second row');
select t.ok((select cardinality(hour_stamps) = 1 from public.feedback_rate_limits where client_key = 'client-a'), 'duplicate did not consume quota');
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-000000000002', 'rating', '', 5::smallint, '1.0', 'en', '/einstellungen', 'client-a')) = 'created', 'rating without text -> created');

-- Constraints (last line of defence)
select t.violates($$insert into public.feedback(submission_id, kind, rating, message) values (gen_random_uuid(), 'bug', 3, 'abcdef')$$, 'bug with rating rejected');
select t.violates($$insert into public.feedback(submission_id, kind, message) values (gen_random_uuid(), 'rating', '')$$, 'rating kind without rating rejected');
select t.violates($$insert into public.feedback(submission_id, kind, rating, message) values (gen_random_uuid(), 'rating', 6, '')$$, 'rating 6 rejected');
select t.violates($$insert into public.feedback(submission_id, kind, rating, message) values (gen_random_uuid(), 'rating', 0, '')$$, 'rating 0 rejected');
select t.violates($$insert into public.feedback(submission_id, kind, message) values (gen_random_uuid(), 'bug', 'ab')$$, 'bug text shorter than 3 rejected');
select t.violates($$insert into public.feedback(submission_id, kind, message) values (gen_random_uuid(), 'bug', repeat('x', 2001))$$, 'message over 2000 rejected');
select t.violates($$insert into public.feedback(submission_id, kind, message) values (gen_random_uuid(), 'spam', 'abcdef')$$, 'unknown kind rejected');
select t.violates($$insert into public.feedback(submission_id, kind, message, lang) values (gen_random_uuid(), 'bug', 'abcdef', 'xx')$$, 'unknown language rejected');
select t.violates($$select * from public.submit_feedback(gen_random_uuid(), 'bug', 'abcdef', null, '1.0', 'de', '/x', '')$$, 'empty client key rejected');

-- Per-client hourly limit: client-a already used 2 (bug + rating); 3 more allowed, then limited
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Idee drei', null, '1.0', 'de', '/', 'client-a')) = 'created', 'client-a #3');
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Idee vier', null, '1.0', 'de', '/', 'client-a')) = 'created', 'client-a #4');
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Idee fünf', null, '1.0', 'de', '/', 'client-a')) = 'created', 'client-a #5');
select t.ok((select status = 'rate_limited' and retry_after_seconds between 1 and 3600 from public.submit_feedback(gen_random_uuid(), 'idea', 'Idee sechs', null, '1.0', 'de', '/', 'client-a')), 'client-a #6 -> rate_limited with retry-after');
select t.ok((select count(*) = 5 from public.feedback), 'limited request stored nothing');
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Anderer Client', null, '1.0', 'de', '/', 'client-b')) = 'created', 'other client unaffected');
-- A retry of a stored submission is still a success while the client is limited
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-000000000001', 'bug', 'Button tut nichts', null, '1.0', 'de', '/einstellungen', 'client-a')) = 'duplicate', 'duplicate retry succeeds while limited');

-- Window expiry: stamps older than an hour no longer count
update public.feedback_rate_limits set hour_stamps = array(select (floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 3700000) from generate_series(1, 5)) where client_key = 'client-a';
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Nach einer Stunde', null, '1.0', 'de', '/', 'client-a')) = 'created', 'old stamps expire');

-- Daily limit (20): fill the day window while the hour window is empty
update public.feedback_rate_limits set hour_stamps = '{}', day_stamps = array(select (floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 4000000) from generate_series(1, 20)) where client_key = 'client-a';
select t.ok((select status = 'rate_limited' from public.submit_feedback(gen_random_uuid(), 'idea', 'Tageslimit', null, '1.0', 'de', '/', 'client-a')), 'daily limit -> rate_limited');

-- Future stamps are discarded (server clock only)
update public.feedback_rate_limits set hour_stamps = array(select (floor(extract(epoch from clock_timestamp()) * 1000)::bigint + 9000000) from generate_series(1, 5)), day_stamps = '{}' where client_key = 'client-b';
select t.ok((select status from public.submit_feedback(gen_random_uuid(), 'idea', 'Zukunft', null, '1.0', 'de', '/', 'client-b')) = 'created', 'future stamps do not lock a client');

-- Global limit
update public.feedback_rate_limits set hour_stamps = array(select (floor(extract(epoch from clock_timestamp()) * 1000)::bigint - 1000) from generate_series(1, 300)) where client_key = '*global*';
select t.ok((select status = 'rate_limited' from public.submit_feedback(gen_random_uuid(), 'idea', 'Global voll', null, '1.0', 'de', '/', 'client-c')), 'global limit -> rate_limited');
reset role;
