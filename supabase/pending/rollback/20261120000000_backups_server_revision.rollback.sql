-- Rollback of 20261120000000_backups_server_revision.sql - READ THE PROCEDURE FIRST.
--
-- A single `drop column` is NOT a safe rollback by itself: a client that already filters on `rev`
-- would receive SQLSTATE 42703 ("column backups.rev does not exist") on its next read/write. The
-- Stage 1 client handles exactly that error (message must name `rev`) by switching, for the rest of
-- the session, to its `updated_at` compare-and-swap - so the rollback is safe ONLY IF every client
-- that can reach the database is at least the Stage 1 client build. Staged procedure:
--   1. Keep (or ship) the Stage 1 client first. Never roll the database back under a pre-Stage-1
--      client that expects `rev` - there is none; older clients never use `rev` and are unaffected.
--   2. Run this file through the same channel as the forward change (a new migration in
--      supabase/migrations merged via PR), never as ad-hoc SQL.
--   3. Verify: `select column_name from information_schema.columns where table_name='backups'` has no
--      `rev`; a manual backup from a current client still succeeds (it falls back once, then CASes
--      on updated_at).
-- The SEQUENCE IS DELIBERATELY KEPT: re-running the forward migration later continues above every
-- number ever issued (`create sequence ... if not exists`), so a revision is never reused.
-- Trade-off while rolled back: writes are no longer revision-tagged (detection falls back to the
-- updated_at token, with the blind-spot documented in docs/data-safety/phase5-writer-inventory.md).
begin;
drop trigger if exists backups_set_rev on public.backups;
drop function if exists public.backups_set_rev();
alter table public.backups drop column if exists rev;
commit;
