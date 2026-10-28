-- STUB of the Supabase pieces the Feedback draft needs, for an ISOLATED, TEMPORARY local PostgreSQL.
-- It is NOT Supabase: auth.uid()/auth.jwt() are re-implemented here (modelled on Supabase's public
-- definitions, from memory) and must be re-verified against a real project. Never run this elsewhere.
\set ON_ERROR_STOP on
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase-like default privileges for objects created by the migration role
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                     (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                     nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
-- the existing AI limiter's table, only to prove that Feedback never touches it
create table public.ai_rate_limits (user_id uuid primary key references auth.users(id) on delete cascade,
  minute_stamps bigint[] default '{}', hour_stamps bigint[] default '{}');
insert into auth.users(id) values ('aaaaaaaa-0000-4000-8000-000000000001'),
                                  ('bbbbbbbb-0000-4000-8000-000000000002'),
                                  ('cccccccc-0000-4000-8000-000000000003');
