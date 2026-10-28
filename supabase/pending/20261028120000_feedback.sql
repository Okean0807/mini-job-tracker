-- DRAFT / NOT APPLIED (variant C2: authenticated users only). Lives in supabase/pending (outside the
-- migration chain on purpose): merging a PR with this file must NOT change any database. Applying needs
-- separate owner approval (verify on a LOCAL stack and a separate test project first, then move to
-- supabase/migrations/ with a newer version).
--
-- Access model
--   * anon: no privileges on the tables, cannot execute submit_feedback.
--   * authenticated: no privileges on the tables; may EXECUTE submit_feedback only.
--   * The author is ALWAYS auth.uid() (taken from the verified JWT by PostgREST). The function has no
--     user id parameter, so nobody can submit on behalf of another user.
--   * Anonymous Supabase sign-ins (JWT claim is_anonymous = true) are refused.
--   * RLS is enabled with NO policies and deliberately NOT forced: the function owner (= table owner,
--     same migration) is exempt, so no BYPASSRLS privilege is required; anon/authenticated stay locked
--     out by REVOKE + RLS without policies.
--   * The owner reads rows with service_role / the dashboard; no service_role key is used by the app.
--   * Rate limits (5 per hour, 20 per day) are per user in their own table. They share nothing with
--     ai_rate_limits / consume_ai_rate_limit. There is no global limit.
--   * Rows are deleted with the account (ON DELETE CASCADE to auth.users).
--   * Retention target (provisional, not final): 6 months. No scheduler is created here; purge manually:
--       delete from public.feedback where created_at < now() - interval '6 months';

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('bug', 'idea', 'rating')),
  rating smallint check (rating between 1 and 5),
  message text not null default '' check (char_length(message) <= 2000),
  app_version text not null check (char_length(app_version) between 1 and 32),
  lang text not null check (lang in ('de', 'en', 'ru', 'tr', 'pl')),
  route text not null check (char_length(route) between 1 and 64),
  constraint feedback_user_submission_key unique (user_id, submission_id),
  constraint feedback_rating_matches_kind
    check ((kind = 'rating' and rating is not null) or (kind <> 'rating' and rating is null)),
  constraint feedback_text_required_unless_rating
    check (kind = 'rating' or char_length(btrim(message)) >= 3)
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;
revoke all on table public.feedback from public, anon, authenticated;

create table if not exists public.feedback_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hour_stamps bigint[] not null default '{}',
  day_stamps bigint[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.feedback_rate_limits enable row level security;
revoke all on table public.feedback_rate_limits from public, anon, authenticated;

-- Returns one row: status in ('created', 'duplicate', 'rate_limited', 'invalid', 'unauthenticated',
-- 'forbidden'). Expected conditions are returned as a status, never raised, so no SQL text or
-- constraint name reaches the client.
create or replace function public.submit_feedback(
  p_submission_id uuid,
  p_kind text,
  p_message text,
  p_rating smallint,
  p_app_version text,
  p_lang text,
  p_route text
)
returns table(status text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now bigint;
  v_hour bigint[];
  v_day bigint[];
  v_retry integer;
  v_inserted integer;
begin
  if v_uid is null then
    return query select 'unauthenticated'::text, 0;
    return;
  end if;
  if lower(coalesce(auth.jwt() ->> 'is_anonymous', 'false')) = 'true' then
    return query select 'forbidden'::text, 0;
    return;
  end if;

  -- Server-side validation (the table CHECKs are the last line of defence).
  if p_submission_id is null
     or p_kind is null or p_kind not in ('bug', 'idea', 'rating')
     or p_message is null or char_length(p_message) > 2000
     or (p_kind = 'rating' and (p_rating is null or p_rating not between 1 and 5))
     or (p_kind <> 'rating' and (p_rating is not null or char_length(btrim(p_message)) < 3))
     or p_lang is null or p_lang not in ('de', 'en', 'ru', 'tr', 'pl')
     or p_app_version is null or char_length(p_app_version) not between 1 and 32
     or p_route is null or char_length(p_route) not between 1 and 64 then
    return query select 'invalid'::text, 0;
    return;
  end if;

  -- A retry of an already stored submission is a success and must not consume quota.
  if exists (select 1 from public.feedback f where f.user_id = v_uid and f.submission_id = p_submission_id) then
    return query select 'duplicate'::text, 0;
    return;
  end if;

  insert into public.feedback_rate_limits(user_id) values (v_uid)
    on conflict (user_id) do nothing;
  select r.hour_stamps, r.day_stamps into v_hour, v_day
    from public.feedback_rate_limits r where r.user_id = v_uid for update;

  -- Read the clock only AFTER the row lock is held: a waiter must not use a time taken before it
  -- queued, otherwise stamps written by the request ahead of it look "in the future" and are not
  -- counted. Stamps more than 1 s in the future are discarded (server clock only).
  v_now := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_hour := coalesce((select array_agg(s) from unnest(v_hour) s
                       where s > v_now - 3600000 and s <= v_now + 1000), '{}');
  v_day := coalesce((select array_agg(s) from unnest(v_day) s
                      where s > v_now - 86400000 and s <= v_now + 1000), '{}');

  if cardinality(v_hour) >= 5 then
    v_retry := greatest(1, ceil(((select min(s) from unnest(v_hour) s) + 3600000 - v_now) / 1000.0))::integer;
  elsif cardinality(v_day) >= 20 then
    v_retry := greatest(1, ceil(((select min(s) from unnest(v_day) s) + 86400000 - v_now) / 1000.0))::integer;
  end if;

  if v_retry is not null then
    update public.feedback_rate_limits
       set hour_stamps = v_hour, day_stamps = v_day, updated_at = now()
     where user_id = v_uid;
    return query select 'rate_limited'::text, v_retry;
    return;
  end if;

  insert into public.feedback(user_id, submission_id, kind, rating, message, app_version, lang, route)
    values (v_uid, p_submission_id, p_kind, p_rating, p_message, p_app_version, p_lang, p_route)
    on conflict (user_id, submission_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select 'duplicate'::text, 0;
    return;
  end if;

  update public.feedback_rate_limits
     set hour_stamps = v_hour || v_now, day_stamps = v_day || v_now, updated_at = now()
   where user_id = v_uid;

  return query select 'created'::text, 0;
end;
$$;

revoke all on function public.submit_feedback(uuid, text, text, smallint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.submit_feedback(uuid, text, text, smallint, text, text, text)
  to authenticated;
