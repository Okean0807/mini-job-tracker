-- Rollback for supabase/pending/20261028120000_feedback.sql (DRAFT, not applied).
-- DESTRUCTIVE: deletes all stored feedback. Export first if rows must be kept.
-- Ship as a new migration file via PR; never as ad-hoc SQL.
-- Emergency switch that keeps the data: revoke execute on function
--   public.submit_feedback(uuid, text, text, smallint, text, text, text) from authenticated;
drop function if exists public.submit_feedback(uuid, text, text, smallint, text, text, text);
drop table if exists public.feedback_rate_limits;
drop table if exists public.feedback;
