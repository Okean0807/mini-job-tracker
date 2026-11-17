-- Stage 1 (APPROVED for preparation, NOT applied anywhere): server-maintained revision for public.backups.
--
-- Every INSERT and UPDATE of a backup row - by ANY role and ANY client, including older app builds
-- that still send a blind upsert and writers that do not touch updated_at - receives a new, globally
-- unique, strictly increasing revision from a sequence. Clients cannot choose it (the trigger
-- overwrites whatever they send). Current clients use it for compare-and-swap; legacy clients keep
-- working unchanged (this migration does NOT reject any write: no Stage 2 enforcement).
--
-- Design notes (verified in scripts/db-tests/rev_run.sh on an isolated local PostgreSQL):
--  * Sequence, not a per-row counter: a revision is never reused after DELETE + INSERT.
--  * The sequence starts at the current time in microseconds, so even a recreated sequence cannot
--    re-issue a number handed out before (~1.8e15 stays below 2^53, i.e. exact as a JSON number).
--  * ADD COLUMN with a volatile DEFAULT rewrites the table once (one row per account: tiny) and gives
--    every existing row its own valid revision.
--  * The trigger function is SECURITY INVOKER with search_path = ''. SECURITY DEFINER is not needed:
--    the column DEFAULT already requires USAGE on the sequence for the writing role, so the same
--    minimal grant covers the trigger. Only USAGE (nextval) is granted - not SELECT/UPDATE, so no role
--    can setval/reset the sequence.
--  * No OWNED BY: dropping the column (rollback) must NOT drop the sequence, otherwise re-upgrading
--    could re-issue numbers that clients still remember.
--  * The function is not callable as an RPC (trigger functions cannot be invoked directly) and EXECUTE
--    is revoked from every client role anyway.
--  * RLS policy, grants on the table and the FK/cascade behaviour are untouched.
begin;

do $$
begin
  if to_regclass('public.backups_rev_seq') is null then
    execute pg_catalog.format(
      'create sequence public.backups_rev_seq as bigint start with %s increment by 1 minvalue 1 no cycle',
      (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000000)::bigint
    );
  end if;
end $$;

-- Least privilege: Supabase default privileges may have granted ALL to client roles.
revoke all on sequence public.backups_rev_seq from public, anon, authenticated, service_role;
grant usage on sequence public.backups_rev_seq to authenticated, service_role;

alter table public.backups
  add column if not exists rev bigint not null default pg_catalog.nextval('public.backups_rev_seq'::pg_catalog.regclass);

create or replace function public.backups_set_rev() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Always server-assigned; any client-supplied value is discarded.
  new.rev := pg_catalog.nextval('public.backups_rev_seq'::pg_catalog.regclass);
  return new;
end
$$;

revoke all on function public.backups_set_rev() from public, anon, authenticated, service_role;

drop trigger if exists backups_set_rev on public.backups;
create trigger backups_set_rev
  before insert or update on public.backups
  for each row execute function public.backups_set_rev();

commit;
