# MiniJob Tracker — Remaining Audit / QA Matrix

Updated 2026-09-30.

## Closed by code changes

- Legal Minijob limit engine and employment classification.
- Actual vs future earnings.
- Rolling 12-month model.
- Unpredictable exceedance tracking.
- Sickness case handling.
- Vacation pay basis.
- Payment ledger: multiple/partial payments, earned/paid/open/overpaid/overdue.
- Cloud sync stale-result protection.
- Account isolation and local-storage auth boundary.
- Account deletion backend function.
- Document server-side validation and private Storage policies.
- AI history limits, historical context, shared rate limit.
- Generated-document local/downloaded-only semantics.
- XLS/XLSX untrusted import removed; spreadsheet dependency is export-only.
- CSV duplicate detection now skips exact duplicates during import.
- Explicit midnight-crossing shift tests.
- Central rounding helpers and boundary tests.

## Still requiring environment / human verification

1. Rotate/revoke historical Supabase secret and inspect Git history.
2. Enable Supabase leaked-password protection.
3. Decide/verify RLS posture for `public.ai_rate_limits`.
4. Add production legal identity data to Impressum/Datenschutz pages.
5. Full notification matrix on real Android/iOS/desktop devices, including closed-app delivery.
6. DST behavior: current Shift model stores local date + HH:mm and has no IANA timezone/UTC timestamp, so DST cannot be modeled exactly without a data-model change.
7. Full account-switching E2E against real auth/storage.
8. Full TypeScript/Vitest/build with installed dependencies.
9. Production browser smoke test.
10. Accessibility audit with keyboard/screen reader/contrast tooling.
11. 360×800 mobile UI audit.
12. Final Statistik/Dashboard/Sync/Backup UX pass.
13. Branchenmindestlohn data model and sourced rates.
14. Arbeitszeitnachweis product/export completion.
15. Import actions beyond automatic skip (explicit Replace/Merge) remain a future product choice.

## Important security boundary

`xlsx` is not used to parse user-provided spreadsheets. `.xlsx`/`.xls` uploads are rejected by the client import flow. The remaining `xlsx` dependency is export-only and must not be reintroduced into a user-controlled parser without a new security review.

## Phase 6 — Branchenmindestlohn

- Added versioned industry-minimum-wage catalog in `src/lib/minijob/industry-minimum-wage.ts`.
- Added current legally binding sector data sourced from BMAS, including Gebäudereinigung LG1/LG6 through 2026 and additional supported sectors with explicit validity periods.
- Added `industrySectorId` / `industryGroupId` to `Job`.
- Added explicit industry/group selection to Job dialog; no automatic legal classification is inferred from the job name.
- Added `wage-compliance.ts` to compare actual hourly pay with the binding floor `max(general statutory minimum wage, applicable industry minimum wage)`.
- The industry floor does **not** alter the Minijob income limit calculation; the latter remains based on the statutory general minimum wage as required by §8 Abs. 1a SGB IV.
- Added unit tests for date boundaries, Gebäudereinigung LG1/LG6, fallback to the general minimum wage, and rate precedence.
- Full Vitest/TypeScript/build remains unverified because the phase workspace has no installed dependencies and no `package-lock.json` (the project uses `bun.lock`, but Bun is unavailable in the current environment).
