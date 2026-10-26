-- Appended by f1_rls_isolated_run.sh after F-1 + the pending RLS migration.
-- Fails the run if RLS is not actually enabled on ai_rate_limits or if any policy
-- exists (the pending migration deliberately creates none).
do $$
declare
  v_rls boolean;
  v_policies integer;
begin
  select relrowsecurity into v_rls from pg_class where oid = 'public.ai_rate_limits'::regclass;
  select count(*) into v_policies from pg_policies
    where schemaname = 'public' and tablename = 'ai_rate_limits';
  if v_rls is distinct from true then
    raise exception 'RLS_ASSERT_FAILED: relrowsecurity=%', v_rls;
  end if;
  if v_policies <> 0 then
    raise exception 'RLS_ASSERT_FAILED: % policies on ai_rate_limits', v_policies;
  end if;
  raise warning 'RLS_ASSERT_OK relrowsecurity=true policies=0';
end $$;
