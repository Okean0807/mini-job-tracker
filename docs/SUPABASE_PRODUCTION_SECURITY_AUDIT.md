# Supabase Production Security Audit — Phase 15

## Confirmed in source / migrations

- `backups`, `documents`, and `document_folders` have RLS enabled with ownership checks based on `auth.uid()`.
- Document rows enforce `user_id`, storage path ownership, and folder ownership through a database trigger.
- The `documents` Storage bucket is private, capped at 20 MiB, and restricted to PDF/JPEG/PNG/WebP MIME types in the migration chain.
- Storage policies restrict authenticated users to objects whose first path component equals their own user id.
- `ai_rate_limits` has client table privileges revoked and RLS enabled without client policies.
- `consume_ai_rate_limit()` is `SECURITY DEFINER`, has a fixed `search_path`, and requires `auth.uid() = p_user_id`.
- `upload-document` derives the user from the bearer token and validates MIME, extension, magic bytes, size, and folder ownership.
- `delete-account` derives the user from the bearer token and deletes user-owned database rows and Storage objects before deleting the Auth user.
- Account deletion now paginates Storage listing/removal instead of assuming a maximum of 1000 objects.

## Requires production verification

- Whether every migration in this chain has actually been applied to the production Supabase project.
- Security Advisor status after deployment.
- Leaked Password Protection setting.
- Auth redirect/site URL configuration.
- Edge Function deployment status for `delete-account` and `upload-document`.
- Real authenticated cross-user/RLS tests against production.
- Storage test with >1000 objects is still a QA scenario, although the deletion code now handles pagination.
- Historical Supabase secret/key rotation and Git history cleanup remain owner/platform actions.

## Important limitation

Source inspection cannot prove the live Supabase configuration. This document therefore deliberately separates code-confirmed controls from production-only verification items.
