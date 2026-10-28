# Feedback: e-mail to the owner

Minimal feature: a signed-in user writes a message (3–2000 characters) in
Settings → Feedback. A TanStack server function sends it by e-mail through the
Resend REST API to the owner's address. Nothing is stored in a database.

## Architecture

- UI: `src/components/minijob/FeedbackDialog.tsx` (one textarea, send button,
  sending indicator, success toast, error text with `role="alert"`).
- Server function: `src/lib/feedback/feedback.functions.ts` with
  `requireSupabaseAuth` (existing app login; guests and anonymous users are rejected).
- Logic: `handler.ts` (validation, rate limit, mail, fail-closed config),
  `schema.ts` (strict zod schema, control characters stripped), `rate-limit.ts`,
  `mailer.ts` (`fetch` to Resend, 8 s timeout, `Idempotency-Key`).
- Success is reported only after Resend answers 2xx with an `id`. Any other answer
  is "unavailable"; provider text and the key are never returned to the client.
- The recipient comes only from `FEEDBACK_TO_EMAIL`; the client cannot influence it.
- No Supabase service-role key, no table, no RPC, no migration.
- The account's e-mail is used as `reply_to` only (not the sender).

## Server variables (Vercel, Production scope only when you are ready)

| Name | Required | Meaning |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | Resend API key (server only, never `VITE_*`) |
| `FEEDBACK_TO_EMAIL` | yes | single owner address |
| `FEEDBACK_FROM_EMAIL` | no | sender; default `MiniJob Companion <onboarding@resend.dev>` |

Without the first two the feature answers "unavailable" and sends nothing.

## Limits

- Per account: 5 per hour, 20 per day; global: 60 per hour. The counter is in server
  memory, so it is per server instance and resets on cold start (best effort). The mail
  provider's own quota is the hard backstop. If abuse appears: persistent limit and/or CAPTCHA.
- Resend free tier (third-party sources, confirm on resend.com/pricing): about 3,000
  mails per month, 100 per day.
- The `onboarding@resend.dev` test sender delivers only to the e-mail of the Resend
  account owner. Register the Resend account with the owner's address, or verify a
  domain (DNS records) and set `FEEDBACK_FROM_EMAIL`.

## What was tested

Unit and integration tests with fake Supabase and fake Resend servers, plus an opt-in
Playwright mobile check (`node scripts/feedback-e2e-check.mjs`, not part of CI).
**Real delivery has not been tested**: it needs a real Resend key and configuration.

## Setup steps (owner)

1. Create a Resend account and an API key.
2. Set the variables above in Vercel, then redeploy.
3. Send a test message from a signed-in account and check the inbox.
4. Decide the privacy wording (`docs/legal/`).
