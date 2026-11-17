-- Minimal Supabase surface for the CAS tests: roles, auth.users, auth.uid(), test helpers.
-- The REAL `public.backups` table and RLS policy come from supabase/migrations/ (applied by cas_run.sh).
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
-- Same contract as Supabase's auth.uid(): reads the claims PostgREST sets per request.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant usage on schema public to authenticated, anon, service_role;
create schema t;
create table t.results (id serial primary key, ok boolean not null, label text not null);
grant usage on sequence t.results_id_seq to public;
create function t.ok(cond boolean, label text) returns text language plpgsql as $$
begin
  insert into t.results(ok, label) values (coalesce(cond, false), label);
  return case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end || label;
end $$;
grant usage on schema t to public;
grant execute on function t.ok(boolean, text) to public;
grant insert on t.results to public;
