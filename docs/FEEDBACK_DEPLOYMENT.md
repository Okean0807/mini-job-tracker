# Feedback - deployment dependencies (draft, nothing applied)

Status: the Feedback code is in PR #157; the SQL is a DRAFT in `supabase/pending/` and is **not applied**
anywhere. Until it is applied and verified, sending feedback fails with "unavailable" (no data is lost).

## Server-only environment (Production only; never `VITE_*`)

| Variable | Purpose | Rule |
|---|---|---|
| `SUPABASE_URL` | PostgREST endpoint | already used by the server client |
| `SUPABASE_SERVICE_ROLE_KEY` | lets the server call `submit_feedback` (the only role allowed to) | **first server path in this repo that needs it on Vercel**; keep it out of Preview unless Preview points to a non-production database |
| `FEEDBACK_HASH_SECRET` | HMAC key for the rate-limit client key | >= 32 characters, >= 12 distinct; `openssl rand -hex 32`; missing/weak = submissions refused; no fallback |
| `FEEDBACK_TRUST_PROXY` | which proxy may tell us the client IP | `vercel` or unset; unset = no IP trusted = submissions refused |

`FEEDBACK_TRUST_PROXY=vercel` is only correct if Vercel's edge replaces `x-forwarded-for` (documented by
Vercel; **confirm on the real deployment** by sending a request with a spoofed `X-Forwarded-For` and checking
that the stored `feedback_rate_limits.client_key` does not change). The code uses the rightmost entry as
defence in depth. IPv6 clients are reduced to their /64 prefix.

## Open items (documented, intentionally not implemented here)

- F4 spam / global cap: 300 submissions per hour for the whole app can be exhausted by ~60 addresses;
  there is no CAPTCHA (needs a separate decision).
- F5 where the service role lives: an Edge Function would keep the key inside Supabase instead of Vercel.
- F6 retention / purge of `feedback` (worst case ~7,200 rows/day, ~14 MB/day) - owner decision.
- Email notification (separate, not started).

## Checks only possible on real Supabase (not done)

Apply the migration in a controlled environment; verify anon/authenticated are denied; verify
`submit_feedback` runs for the real migration owner; call it with supabase-js and the service key;
confirm limits, duplicate handling and rollback; confirm PostgREST finds the function (schema cache).
