# Phase 12 — Security hardening

## Applied in source

- Enabled RLS on `public.ai_rate_limits`.
- No client RLS policy is created for that table.
- The existing `SECURITY DEFINER` rate-limit function remains the intended access path and validates `auth.uid() = p_user_id`.
- Added regression tests for the AI rate-limit security boundary and the SheetJS/untrusted-import boundary.

## Not claimable from the repository alone

- Supabase Auth leaked-password protection setting.
- Rotation/revocation of historical credentials.
- GitHub secret scanning availability.
- Production migration execution.
- Real production login/sync/account-deletion smoke test.

These require the connected Supabase/GitHub/Vercel control planes or a local test environment with dependencies installed.
