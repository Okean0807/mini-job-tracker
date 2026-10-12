# Pending (NOT applied) migrations

Files here are NOT part of the Supabase migration chain and are NOT applied by
Supabase Branching / `db push`.

- `20260930220000_p1_ai_rate_limit_rls.sql` — enables RLS on `public.ai_rate_limits`.
  Verified 2026-10-11 (read-only catalog check): NOT applied in production
  (`relrowsecurity = false`). Table privileges for anon/authenticated are revoked,
  so access is only via the SECURITY DEFINER function `consume_ai_rate_limit`.
  To apply: move back into `supabase/migrations/` with a new version newer than
  the latest applied remote version, after explicit approval.
- `20261012160000_p2_documents_no_direct_client_write.sql` — drops the direct
  client INSERT/UPDATE policies on `storage.objects` for bucket `documents`
  (late-upload window after account deletion; app uploads only via
  `upload-document`). Live state 2026-10-12: both policies present. NOT applied.
