create table if not exists public.ai_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  minute_stamps bigint[] not null default '{}',
  hour_stamps bigint[] not null default '{}',
  updated_at timestamptz not null default now()
);

revoke all on table public.ai_rate_limits from anon, authenticated;

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

  v_minute := array(select x from unnest(coalesce(v_minute, '{}')) x where p_now_ms - x < 60000 order by x);
  v_hour := array(select x from unnest(coalesce(v_hour, '{}')) x where p_now_ms - x < 3600000 order by x);

  if cardinality(v_minute) >= 8 then
    v_oldest := v_minute[1];
    v_retry := greatest(1, ceil((v_oldest + 60000 - p_now_ms) / 1000.0)::integer);
    update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
    return query select false, v_retry;
    return;
  end if;

  if cardinality(v_hour) >= 60 then
    v_oldest := v_hour[1];
    v_retry := greatest(1, ceil((v_oldest + 3600000 - p_now_ms) / 1000.0)::integer);
    update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
    return query select false, v_retry;
    return;
  end if;

  v_minute := array_append(v_minute, p_now_ms);
  v_hour := array_append(v_hour, p_now_ms);
  update public.ai_rate_limits set minute_stamps=v_minute, hour_stamps=v_hour, updated_at=now() where user_id=p_user_id;
  return query select true, 0;
end;
$$;

revoke all on function public.consume_ai_rate_limit(uuid, bigint) from public;
grant execute on function public.consume_ai_rate_limit(uuid, bigint) to authenticated;
