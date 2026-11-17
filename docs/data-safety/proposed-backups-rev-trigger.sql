-- PROPOSAL ONLY – NOT a migration, NOT applied anywhere (needs separate owner approval).
-- Purpose: make every change to public.backups visible to a compare-and-swap client, including
-- writes by legacy clients (blind upsert, payload change without touching updated_at, token reuse/ABA).
--
-- Stage 1 (non-breaking): server-maintained revision. Old clients keep working unchanged; their writes
--   bump `rev`, so NEW clients (CAS on `rev`) detect them instead of silently overwriting.
-- Stage 2 (breaking for legacy clients, only after they have died out): reject UPDATEs that do not
--   present the expected revision (see "Stage 2 sketch" below).
alter table public.backups add column rev bigint not null default 1;

create or replace function public.backups_bump_rev() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
  else
    new.rev := old.rev + 1;           -- the client can never choose (or reuse) a revision
  end if;
  return new;
end $$;

create trigger backups_bump_rev before insert or update on public.backups
  for each row execute function public.backups_bump_rev();

-- Stage 2 sketch (PostgREST exposes request headers to SQL):
--   in the same trigger, for UPDATE only:
--     if coalesce(current_setting('request.headers', true)::jsonb ->> 'x-expected-rev', '') <> old.rev::text
--        and current_user = 'authenticated' then raise exception 'cas_required' using errcode = 'P0001'; end if;
--   Clients then send `x-expected-rev` (supabase-js `headers` option) together with the rev filter.
