-- Minimal Supabase stub for an ISOLATED local PostgreSQL (never prod): API roles only.
\set ON_ERROR_STOP on
do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'tester') then create role tester login; end if; end $$;
grant anon, authenticated, service_role to tester;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create schema t;
grant usage on schema t to public;
create function t.ok(cond boolean, name text) returns text language plpgsql as
  $$ begin if cond is not true then raise exception 'ASSERT FAILED: %', name; end if; return 'PASS ' || name; end $$;
create function t.denied(stmt text, role_name text, name text) returns text language plpgsql as
  $$ begin
       execute format('set local role %I', role_name);
       begin execute stmt; exception when insufficient_privilege then reset role; return 'PASS ' || name; end;
       reset role;
       raise exception 'ASSERT FAILED (no privilege error): %', name;
     end $$;
create function t.violates(stmt text, name text) returns text language plpgsql as
  $$ begin begin execute stmt; exception when check_violation or raise_exception then return 'PASS ' || name; end;
       raise exception 'ASSERT FAILED (constraint not enforced): %', name; end $$;
