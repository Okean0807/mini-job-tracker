# Release blockers

Only unresolved blockers. Updated 2026-11-14.

| # | Blocker | Why it blocks | Needed from the owner |
|---|---|---|---|
| B1 | Datenschutz text is explicitly not final and still lists AI as used; no terms of use | Public launch with accounts and cloud without the required privacy information | Final text matching the real configuration (Supabase Frankfurt, Vercel function region US East, Google login, Nominatim, AI off), reviewed by a lawyer or data-protection specialist |
| B2 | Sick and vacation categories are stored and synced to the cloud (special-category data) | Needs a legal basis the app does not collect; owner decided on a neutral "Abwesend" | Confirm the open design decisions: public holiday as Abwesend; period across a month boundary stored as two records; fate of old notes; default flags from the last record |
| B3 | Industry minimum wage table has errors and no expiry handling | The app can tell a care or cleaning worker that a lower rate is compliant | Access to the primary sources (blocked from the CI sandbox) or the decision to replace the table with a user-entered value |
| B4 | Preview browser QA of #166 not done | The exact-rate UI is untested on the deployed Preview | A person with a normal browser runs the case list on the Preview |
| B5 | Manual checks not possible from the sandbox: two accounts on one device, two devices with a sync conflict, iPhone and Android | Account isolation and sync are only code- and unit-test verified | A person with the devices |
| B6 | Vercel `public-local` project cannot build (missing Supabase variables) and turns every PR status red | Noise that can hide a real failure | Decide: set the variables in that project, or remove or pause the project |
| B7 | Supabase warnings: `consume_ai_rate_limit` is executable by signed-in users; leaked-password protection is off | Low today (AI off, Google-only login) | Decide whether to change production settings; a pending migration for RLS on `ai_rate_limits` exists |

Owner actions that must not be done without an explicit decision: merging into `main` (auto-deploys to Production), rotating or revoking any credential, changing Vercel or Supabase production settings, deleting the unused `dokuments` storage bucket.
