# Security / legal residuals after Phase 1

## Supabase `public.ai_rate_limits`

The production database currently reports RLS disabled for `public.ai_rate_limits`.
The table has direct table privileges revoked from `anon` and `authenticated`, while the
rate-limit operation is exposed through the authenticated, `SECURITY DEFINER` function
`consume_ai_rate_limit(uuid, bigint)` and verifies `auth.uid() = p_user_id`.

The remaining hardening is to enable RLS on the table. This change is intentionally **not
applied automatically** because enabling RLS without reviewing the policy/function posture
can change production access semantics.

Proposed SQL for the owner/operator to review:

```sql
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
```

After enabling RLS, verify that `consume_ai_rate_limit` continues to work as intended and that
no direct client access is required. Do not add broad `anon`/`authenticated` policies.

## Legal pages

Technical routes are now present:

- `/impressum`
- `/datenschutz`
- `/ki-hinweise`

They deliberately contain explicit publication placeholders rather than invented operator,
address, provider, retention, or legal-basis data. Before a public release, the real operator
must complete these documents.

## Still requiring external/human verification

- rotate/revoke any historical Supabase secret and clean Git history as required;
- verify Vercel/Supabase environment variables and secret scanning;
- configure leaked-password protection in Supabase Auth;
- complete the final legal text with the actual operator and processors;
- run the full TypeScript/Vitest/build suite once dependencies are available.
