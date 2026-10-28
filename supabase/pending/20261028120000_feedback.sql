-- DRAFT / NOT APPLIED. Lives in supabase/pending (outside the migration chain on purpose):
-- merging this PR must NOT change any database. Applying needs separate owner approval
-- (move to supabase/migrations/ with a newer version, review, controlled test first).
--
-- Feedback (bug / idea / rating). Access model:
--   * anon / authenticated: NO privileges on either table, RLS enabled, NO policies
--     -> no public read, insert, update or delete.
--   * Only the server (service_role, via the TanStack server function) may call
--     public.submit_feedback(); the owner reads rows with service_role / the dashboard.
--   * No user_id, no IP, no email is stored. Rate limiting uses a keyed hash of the IP
--     computed by the server (feedback_rate_limits.client_key), not the IP itself.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('bug', 'idea', 'rating')),
  rating smallint check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 2000),
  app_version text check (char_length(app_version) between 1 and 32),
  lang text check (lang in ('de', 'en', 'ru', 'tr', 'pl')),
  route text check (char_length(route) between 1 and 64),
  constraint feedback_rating_matches_kind
    check ((kind = 'rating' and rating is not null) or (kind <> 'rating' and rating is null)),
  constraint feedback_text_required_unless_rating
    check (kind = 'rating' or char_length(btrim(message)) >= 3)
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;
alter table public.feedback force row level security;
revoke all on table public.feedback from public, anon, authenticated;

create table if not exists public.feedback_rate_limits (
  client_key text primary key check (char_length(client_key) between 1 and 64),
  hour_stamps bigint[] not null default '{}',
  day_stamps bigint[] not null default '{}',
  updated_at timestamptz not null default now()
);

create index if not exists feedback_rate_limits_updated_at_idx
  on public.feedback_rate_limits (updated_at);

alter table public.feedback_rate_limits enable row level security;
alter table public.feedback_rate_limits force row level security;
revoke all on table public.feedback_rate_limits from public, anon, authenticated;

-- Limits: 5 per hour and 20 per day per client key, 300 per hour for the whole app.
create or replace function public.submit_feedback(
  p_submission_id uuid,
  p_kind text,
  p_message text,
  p_rating smallint,
  p_app_version text,
  p_lang text,
  p_route text,
  p_client_key text
)
returns table(status text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now bigint;
  v_hour bigint[];
  v_day bigint[];
  v_g_hour bigint[];
  v_retry integer;
  v_inserted integer;
begin
  -- Defence in depth: the server already validated; the table CHECKs are the last line.
  if p_submission_id is null or p_kind not in ('bug', 'idea', 'rating')
     or p_client_key is null or char_length(p_client_key) not between 1 and 64 then
    raise exception 'invalid';
  end if;

  -- A retry of an already stored submission is a success and must not consume quota.
  if exists (select 1 from public.feedback f where f.submission_id = p_submission_id) then
    return query select 'duplicate'::text, 0;
    return;
  end if;

  -- Housekeeping: drop idle limiter rows (keys are hashes, no personal data).
  delete from public.feedback_rate_limits
   where updated_at < now() - interval '2 days'
     and client_key not in (p_client_key, '*global*');

  insert into public.feedback_rate_limits(client_key) values (p_client_key)
    on conflict (client_key) do nothing;
  insert into public.feedback_rate_limits(client_key) values ('*global*')
    on conflict (client_key) do nothing;

  select r.hour_stamps, r.day_stamps into v_hour, v_day
    from public.feedback_rate_limits r where r.client_key = p_client_key for update;
  select r.hour_stamps into v_g_hour
    from public.feedback_rate_limits r where r.client_key = '*global*' for update;

  -- Read the clock only AFTER the row locks are held: a waiter must not use a time taken
  -- before it queued, otherwise stamps written by the request ahead of it look "in the future"
  -- and are not counted (found by the concurrency test: 12 parallel calls created 6, not 5).
  v_now := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- Only stamps within the window; stamps more than 1 s in the future are discarded (server clock).
  v_hour := coalesce((select array_agg(s) from unnest(v_hour) s where s > v_now - 3600000 and s <= v_now + 1000), '{}');
  v_day := coalesce((select array_agg(s) from unnest(v_day) s where s > v_now - 86400000 and s <= v_now + 1000), '{}');
  v_g_hour := coalesce((select array_agg(s) from unnest(v_g_hour) s where s > v_now - 3600000 and s <= v_now + 1000), '{}');

  if cardinality(v_hour) >= 5 then
    v_retry := greatest(1, ceil(((select min(s) from unnest(v_hour) s) + 3600000 - v_now) / 1000.0))::integer;
  elsif cardinality(v_day) >= 20 then
    v_retry := greatest(1, ceil(((select min(s) from unnest(v_day) s) + 86400000 - v_now) / 1000.0))::integer;
  elsif cardinality(v_g_hour) >= 300 then
    v_retry := greatest(1, ceil(((select min(s) from unnest(v_g_hour) s) + 3600000 - v_now) / 1000.0))::integer;
  end if;

  if v_retry is not null then
    update public.feedback_rate_limits
       set hour_stamps = v_hour, day_stamps = v_day, updated_at = now()
     where client_key = p_client_key;
    return query select 'rate_limited'::text, v_retry;
    return;
  end if;

  insert into public.feedback(submission_id, kind, rating, message, app_version, lang, route)
    values (p_submission_id, p_kind, p_rating, coalesce(p_message, ''), p_app_version, p_lang, p_route)
    on conflict (submission_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select 'duplicate'::text, 0;
    return;
  end if;

  update public.feedback_rate_limits
     set hour_stamps = v_hour || v_now, day_stamps = v_day || v_now, updated_at = now()
   where client_key = p_client_key;
  update public.feedback_rate_limits
     set hour_stamps = v_g_hour || v_now, updated_at = now()
   where client_key = '*global*';

  return query select 'created'::text, 0;
end;
$$;

revoke all on function public.submit_feedback(uuid, text, text, smallint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, smallint, text, text, text, text)
  to service_role;
