-- PENDING (NOT applied). Fix: consume_ai_rate_limit trusted a caller-supplied
-- clock. `authenticated` has EXECUTE and may call the RPC directly with an
-- arbitrary p_now_ms; a far-future value purges all real stamps
-- (p_now_ms - x >= window), which resets the user's own counters and bypasses
-- the 8/min and 60/h limits used by askAssistant (src/lib/ai.functions.ts).
--
-- Change: the signature (uuid, bigint) and the grants stay identical so callers
-- remain compatible (askAssistant passes only p_user_id). p_now_ms is ignored;
-- the server clock is always used. Stored future stamps (from earlier abuse) are
-- discarded by the "x <= now" filter.
--
-- Rollback: re-apply the function body from
-- supabase/migrations/20260930192406_p1_ai_rate_limit.sql (lines 10-59).
create or replace function public.consume_ai_rate_limit(
  p_user_id uuid,
  p_now_ms bigint default floor(extract(epoch from clock_timestamp()) * 1000)::bigint
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_minute bigint[];
  v_hour bigint[];
  v_oldest bigint;
  v_retry integer;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  insert into public.ai_rate_limits(user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  select minute_stamps, hour_stamps into v_minute, v_hour
  from public.ai_rate_limits where user_id = p_user_id for update;

  v_minute := array(select x from unnest(coalesce(v_minute, '{}')) x where x <= v_now and v_now - x < 60000 order by x);
  v_hour := array(select x from unnest(coalesce(v_hour, '{}')) x where x <= v_now and v_now - x < 3600000 order by x);

  if cardinality(v_minute) >= 8 then
    v_oldest := v_minute[1];
    v_retry := greatest(1, ceil((v_oldest + 60000 - v_now) / 1000.0)::integer);
    update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
    return query select false, v_retry;
    return;
  end if;

  if cardinality(v_hour) >= 60 then
    v_oldest := v_hour[1];
    v_retry := greatest(1, ceil((v_oldest + 3600000 - v_now) / 1000.0)::integer);
    update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
    return query select false, v_retry;
    return;
  end if;

  v_minute := array_append(v_minute, v_now);
  v_hour := array_append(v_hour, v_now);
  update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_ai_rate_limit(uuid, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_rate_limit(uuid, bigint) to authenticated;
