# Pending (NOT applied) migrations

Files here are NOT part of the Supabase migration chain and are NOT applied by
Supabase Branching / `db push`.

- `20260930220000_p1_ai_rate_limit_rls.sql` — enables RLS on `public.ai_rate_limits`.
  Verified 2026-10-11 and re-verified 2026-10-12 (read-only catalog check, see docs/security/ai-rate-limits-rls-audit.md): NOT applied in production
  (`relrowsecurity = false`). Table privileges for anon/authenticated are revoked,
  so access is only via the SECURITY DEFINER function `consume_ai_rate_limit`.
  To apply: move back into `supabase/migrations/` with a new version newer than
  the latest applied remote version, after explicit approval.
- `20261012160000_p2_documents_no_direct_client_write.sql` — drops the direct
  client INSERT/UPDATE policies on `storage.objects` for bucket `documents`
  (late-upload window after account deletion; app uploads only via
  `upload-document`). Live state 2026-10-12: both policies present. NOT applied.
  Rollback: `rollback/20261012160000_p2_documents_no_direct_client_write.rollback.sql`,
  applied through the same channel as the forward change (a new migration file in
  `supabase/migrations/` merged via PR), never as ad-hoc SQL.
- `20261014100000_p2_ai_rate_limit_server_clock.sql` — no longer pending: moved to
  `supabase/migrations/` (F-1, t604) after the author DB run on an isolated, socket-only
  PostgreSQL 17.6 (author run, t604; behaviour tests in this PR: `scripts/db-tests/pr140_run.sh`). `consume_ai_rate_limit` ignores
  the caller-supplied `p_now_ms` and uses the server clock, read after the per-user row
  lock; stamps more than 1 s in the future are discarded. Signature, return type,
  SECURITY DEFINER, search_path and grants unchanged. It takes effect in production only
  when merged to `main`; independent QA DB run and owner approval are still required.
  Rollback: function body from `supabase/migrations/20260930192406_p1_ai_rate_limit.sql`,
  shipped as a new migration. **Rollback re-opens F-1** (caller-controlled `p_now_ms`
  bypass) — emergency use only.
