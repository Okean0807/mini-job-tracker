# Feedback (variant C2: signed-in users only) - deployment notes

Status: code in this branch; the SQL is a DRAFT in `supabase/pending/` and is **not applied** anywhere.
Until it is applied and verified, sending feedback fails with "unavailable" (nothing is lost, nothing is stored).
Tested so far: unit/integration tests against a FAKE Supabase and SQL on a TEMPORARY local PostgreSQL
with a stub of Supabase's `auth` schema. **The real Supabase has not been tested.**

## Architecture

```
signed-in browser -> server function submitFeedback (Vercel)
   CSRF middleware + attachSupabaseAuth (bearer token)      src/start.ts
   requireSupabaseAuth: getClaims(token) -> user-scoped client (publishable key + the user's JWT)
   zod strict validation (comfort + error masking)          src/lib/feedback/schema.ts, handler.ts
   -> PostgREST rpc submit_feedback (role: authenticated)
        auth.uid() = author, is_anonymous refused, validation, 5/hour + 20/day per user, idempotent
```

The security boundary is the SQL function: any signed-in user may also call the RPC directly, so validation
and limits live there. The server function adds CSRF protection, error masking and a place for a future
CAPTCHA check.

## Environment

No new variables. Feedback uses the existing public Supabase URL and publishable key and the user's token.
It **never** uses `SUPABASE_SERVICE_ROLE_KEY`, and no IP/HMAC/proxy settings exist any more
(`FEEDBACK_HASH_SECRET`, `FEEDBACK_TRUST_PROXY` were removed with the guest mechanics).

## Reading, retention, deletion

- The owner reads rows with the Supabase dashboard / service role. Useful overview (read-only):
  `select date_trunc('hour', created_at) h, count(*) from public.feedback group by 1 order by 1 desc limit 48;`
- Provisional retention: 6 months (NOT final, legal review open). No scheduler is created; purge manually:
  `delete from public.feedback where created_at < now() - interval '6 months';`
- Rows and the limiter row are deleted with the account (`ON DELETE CASCADE` to `auth.users`;
  `delete-account` hard-deletes the auth user). Provider backups are outside this.
- Emergency switch that keeps all data: `revoke execute on function public.submit_feedback(uuid, text, text,
  smallint, text, text, text) from authenticated;`

## Open items (not implemented on purpose)

- CAPTCHA (to be studied before the public launch; Turnstile fits the server function), e-mail
  notifications (not needed for 1.0), a global limit (removed for 1.0; many accounts can still add up to
  20 rows/day each - watch the overview query).
- Datenschutz and Impressum are drafts/placeholders; legal readiness is not complete.

## Checks that are only possible on a real Supabase (NOT done)

1. Local Supabase stack (`supabase start`, needs a container runtime; not run here) with the migration copied
   into a throw-away worktree's `supabase/migrations/`.
2. A separate test project (owner decision, possible cost): apply the draft there only, never in Production;
   confirm `auth.uid()`/`auth.jwt()` and the `is_anonymous` claim, default function privileges, owner role,
   PostgREST schema cache and `smallint` parameter, advisors, and that the function is callable only with a
   user JWT (`curl` with `apikey` + `Authorization`), 401/permission denied without it, cascade on a real
   user deletion, rollback and re-apply.
3. `scripts/feedback-transport-check.mjs` against that project's URL with real tokens (it only uses a fake
   Supabase today).
4. Real device (Android): signed-in send, expired session, guest sees the sign-in suggestion.
5. Supabase advisors will probably warn about a SECURITY DEFINER function executable by `authenticated`
   in an exposed schema (same pattern as `consume_ai_rate_limit`); decide explicitly.
