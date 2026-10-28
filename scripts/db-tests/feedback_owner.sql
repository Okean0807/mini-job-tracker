\set ON_ERROR_STOP on
\pset tuples_only on
-- Run in a database whose objects are owned by a plain role (no superuser, no BYPASSRLS):
-- proves submit_feedback works without any BYPASSRLS privilege of its owner.
select t.ok((select not rolsuper and not rolbypassrls from pg_roles r join pg_proc p on p.proowner = r.oid
             where p.oid = 'public.submit_feedback(uuid,text,text,smallint,text,text,text,text)'::regprocedure),
            'function owner is neither superuser nor BYPASSRLS');
select t.ok((select not rolsuper and not rolbypassrls from pg_roles r join pg_class c on c.relowner = r.oid
             where c.oid = 'public.feedback'::regclass), 'table owner is neither superuser nor BYPASSRLS');
set role service_role;
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-0000000000c1', 'bug', 'ohne bypassrls', null, '1.0', 'de', '/', 'owner-test')) = 'created', 'created with a non-BYPASSRLS owner');
select t.ok((select status from public.submit_feedback('00000000-0000-4000-8000-0000000000c1', 'bug', 'ohne bypassrls', null, '1.0', 'de', '/', 'owner-test')) = 'duplicate', 'duplicate with a non-BYPASSRLS owner');
reset role;
-- anon / authenticated stay locked out (checked in feedback_behaviour.sql as well)
select t.denied('select * from public.feedback', 'anon', 'anon still cannot read');
select t.denied('select * from public.feedback', 'authenticated', 'authenticated still cannot read');
select t.denied($$select * from public.submit_feedback(gen_random_uuid(), 'bug', 'abcdef', null, '1.0', 'de', '/', 'k')$$, 'authenticated', 'authenticated still cannot call the function');

-- leave the tables empty for the shared behaviour file
reset role;
truncate public.feedback, public.feedback_rate_limits;
