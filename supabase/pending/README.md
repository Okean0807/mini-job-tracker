# Pending (NOT applied) migrations

Files here are NOT part of the Supabase migration chain and are NOT applied by
Supabase Branching / `db push`.

F-1 (`consume_ai_rate_limit` server clock) is no longer pending: it lives in
`supabase/migrations/20261014100000_p2_ai_rate_limit_server_clock.sql` (same bytes
as `release/v1.0-integration` @ 08e3874) and reaches production only when merged
into `main`. Live state 2026-10-26 (read-only catalog check): NOT applied in
production (function still windows on the caller's `p_now_ms`).

Ordering (read before moving any file below into `supabase/migrations/`):
the Supabase GitHub integration applies new files in version order and a file
older than an already-applied remote version is not applied cleanly. Both pending
versions are older than the newest file in the chain (`20261014100000`), so each
must be **renumbered to a version newer than the newest migration** when moved —
unless it reaches `main` in the same merge as F-1 while F-1 is not yet applied
remotely (then `20261012160000` still sorts before `20261014100000`).
Verified 2026-10-26 on an isolated local PostgreSQL 16.15 cluster
(`scripts/db-tests/f1_isolated_run.sh` with F-1 + `20260930220000` concatenated and
an explicit `relrowsecurity` assertion): all 39 rate-limit behaviour checks pass
with RLS enabled and no policies, because `consume_ai_rate_limit` is SECURITY
DEFINER owned by `postgres` (table owner, BYPASSRLS — same owners as production).
C-1 drops only the documents-bucket INSERT/UPDATE policies; the app's client code
only uses `createSignedUrl` (SELECT) and `remove` (DELETE), both kept, and uploads
go through the `upload-document` Edge Function (service role).

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
