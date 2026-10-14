-- Minimal Supabase stub for an ISOLATED local PostgreSQL (never prod).
-- Roles, auth schema, auth.uid() from the request.jwt.claim.sub GUC, Supabase-like
-- default EXECUTE privileges, and a no-op stub for the trigger function named in 192446.
\set ON_ERROR_STOP on
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role tester login;               -- session role that can switch into the API roles
grant anon, authenticated, service_role to tester;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create function public.enforce_document_account_isolation() returns trigger language plpgsql security definer
  as $$ begin return new; end $$;
insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
create schema t;
grant usage on schema t to public;
create function t.ok(cond boolean, name text) returns text language plpgsql as
  $$ begin if cond is not true then raise exception 'ASSERT FAILED: %', name; end if; return 'PASS ' || name; end $$;
create function t.now_ms() returns bigint language sql as
  $$ select floor(extract(epoch from clock_timestamp()) * 1000)::bigint $$;
create function t.reset(u uuid, m bigint[] default '{}', h bigint[] default '{}') returns void language plpgsql as
  $$ begin insert into public.ai_rate_limits(user_id, minute_stamps, hour_stamps) values (u, m, h)
     on conflict (user_id) do update set minute_stamps = excluded.minute_stamps, hour_stamps = excluded.hour_stamps; end $$;
-- Calls consume_ai_rate_limit n times as separate statements (an uncorrelated
-- LATERAL call would be evaluated only once). p_now_ms = base + i*step, or NULL/default.
create function t.calls(u uuid, n int, base bigint default null, step bigint default 0, use_default boolean default true)
returns int language plpgsql as $$
declare k int := 0; r record;
begin
  for i in 1..n loop
    if use_default then select * into r from public.consume_ai_rate_limit(u);
    else select * into r from public.consume_ai_rate_limit(u, base + i * step); end if;
    if r.allowed then k := k + 1; end if;
  end loop;
  return k;
end $$;
grant execute on all functions in schema t to public;
