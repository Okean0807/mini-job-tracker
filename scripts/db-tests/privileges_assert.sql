-- Appended by ai_rate_limits_access_run.sh after F-1 (optionally + the pending RLS
-- migration). Proves that the API roles cannot touch public.ai_rate_limits directly
-- and that consume_ai_rate_limit() stays the only access path. Fails the run with
-- PRIV_ASSERT_FAILED on any deviation.
--
-- Catalog checks use has_*_privilege(), which includes PUBLIC grants and privileges
-- inherited through role membership. The behavioural checks really execute each
-- statement as the role and require SQLSTATE 42501 (insufficient_privilege); all
-- their side effects are rolled back, so the tests that run afterwards see the
-- same state as before.
do $$
declare
  u constant uuid := '11111111-1111-1111-1111-111111111111';
  v constant uuid := '22222222-2222-2222-2222-222222222222';
  tbl constant regclass := 'public.ai_rate_limits'::regclass;
  fn constant regprocedure := 'public.consume_ai_rate_limit(uuid,bigint)'::regprocedure;
  r text;
  p text;
  q text;
  denied integer := 0;
  rpc_allowed boolean;
  rpc_forbidden boolean := false;
  anon_rpc_denied boolean := false;
  secdef boolean;
  fn_owner text;
  fn_config text[];
  before_rows text;
begin
  select coalesce(string_agg(t::text, ';' order by user_id), '') into before_rows from public.ai_rate_limits t;
  -- 1. Catalog: effective table, column and function privileges.
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r and (rolsuper or rolbypassrls)) then
      raise exception 'PRIV_ASSERT_FAILED: % is superuser or BYPASSRLS', r;
    end if;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(r, tbl, p) then
        raise exception 'PRIV_ASSERT_FAILED: % has % on ai_rate_limits', r, p;
      end if;
    end loop;
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
      if has_any_column_privilege(r, tbl, p) then
        raise exception 'PRIV_ASSERT_FAILED: % has column-level % on ai_rate_limits', r, p;
      end if;
    end loop;
  end loop;
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
             where c.oid = tbl and a.grantee = 0) then
    raise exception 'PRIV_ASSERT_FAILED: PUBLIC has a grant on ai_rate_limits';
  end if;
  if exists (select 1 from pg_proc f, aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
             where f.oid = fn and a.grantee = 0) then
    raise exception 'PRIV_ASSERT_FAILED: PUBLIC can execute consume_ai_rate_limit';
  end if;
  if has_function_privilege('anon', fn, 'EXECUTE') then
    raise exception 'PRIV_ASSERT_FAILED: anon can execute consume_ai_rate_limit';
  end if;
  if not has_function_privilege('authenticated', fn, 'EXECUTE') then
    raise exception 'PRIV_ASSERT_FAILED: authenticated cannot execute consume_ai_rate_limit';
  end if;
  select f.prosecdef, pg_get_userbyid(f.proowner), f.proconfig into secdef, fn_owner, fn_config
    from pg_proc f where f.oid = fn;
  if secdef is distinct from true or fn_owner <> pg_get_userbyid((select relowner from pg_class where oid = tbl))
     or not ('search_path=public' = any(coalesce(fn_config, '{}'))) then
    raise exception 'PRIV_ASSERT_FAILED: function secdef=% owner=% config=%', secdef, fn_owner, fn_config;
  end if;

  -- 2. Behaviour, inside a block that is always rolled back at the end.
  begin
    foreach r in array array['anon', 'authenticated'] loop
      foreach q in array array[
        'select count(*) from public.ai_rate_limits',
        format('select 1 from public.ai_rate_limits where user_id = %L for update', u),
        format('insert into public.ai_rate_limits(user_id) values (%L)', v),
        'update public.ai_rate_limits set minute_stamps = ''{}''',
        'delete from public.ai_rate_limits',
        'truncate public.ai_rate_limits'
      ] loop
        begin
          execute format('set local role %I', r);
          perform set_config('request.jwt.claim.sub', u::text, true);
          execute q;
          raise exception 'PRIV_ASSERT_FAILED: % could run: %', r, q;
        exception when insufficient_privilege then
          denied := denied + 1;
        end;
      end loop;
    end loop;

    -- anon cannot call the RPC at all.
    begin
      set local role anon;
      perform public.consume_ai_rate_limit(u);
      raise exception 'PRIV_ASSERT_FAILED: anon could execute consume_ai_rate_limit';
    exception when insufficient_privilege then
      anon_rpc_denied := true;
    end;

    -- authenticated: the RPC works for the token user on a fresh row ...
    delete from public.ai_rate_limits where user_id = v;
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v::text, true);
    select allowed into rpc_allowed from public.consume_ai_rate_limit(v);
    -- ... and refuses a different user id.
    begin
      perform public.consume_ai_rate_limit(u);
    exception when raise_exception then
      rpc_forbidden := sqlerrm = 'forbidden';
    end;
    reset role;

    raise exception using errcode = 'P0099', message = 'priv_assert_rollback';
  exception when sqlstate 'P0099' then
    null; -- every side effect of section 2 is discarded here
  end;

  if denied <> 12 or not anon_rpc_denied or rpc_allowed is distinct from true or not rpc_forbidden then
    raise exception 'PRIV_ASSERT_FAILED: denied=% anon_rpc_denied=% rpc_allowed=% rpc_forbidden=%',
      denied, anon_rpc_denied, rpc_allowed, rpc_forbidden;
  end if;
  if before_rows <> (select coalesce(string_agg(t::text, ';' order by user_id), '') from public.ai_rate_limits t) then
    raise exception 'PRIV_ASSERT_FAILED: behavioural checks left state behind';
  end if;
  raise warning 'PRIV_ASSERT_OK denied=%/12 anon_rpc_denied=% rpc_allowed=% rpc_forbidden_other_user=% rls=% service_role_select=%',
    denied, anon_rpc_denied, rpc_allowed, rpc_forbidden,
    (select relrowsecurity from pg_class where oid = tbl),
    has_table_privilege('service_role', tbl, 'SELECT');
end $$;
