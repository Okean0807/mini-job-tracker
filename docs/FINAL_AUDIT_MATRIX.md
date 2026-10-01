# MiniJob Tracker — Final Audit Matrix

Audit basis: original `Аудит MiniJob Tracker.txt` and the current Phase 16 source tree.

Status meanings:
- ✅ **Closed in code** — current source contains the requested implementation or boundary.
- ⚠️ **Production/QA verification required** — implementation exists, but cannot be confirmed against live infrastructure/device/build from this workspace.
- 🔴 **Manual/product action required** — code alone cannot complete the requirement, or a material gap remains.

## P0 / legal-security core

| # | Original audit item | Status | Current evidence / remaining action |
|---|---|---|---|
| 1 | Rotate old Supabase key / Git history | 🔴 | Historical secret rotation and Git-history cleanup are owner/platform actions. Not verifiable from source tree. |
| 2 | `xlsx@0.18.5` vulnerability | ⚠️ | XLS/XLSX import path removed; direct SheetJS use isolated to write-only adapter. Dependency remains `xlsx@^0.18.5`, so underlying dependency is not vulnerability-free. |
| 3 | Correct Minijob limit engine | ✅ | Legal engine has 2026 €603 / €7,236 rules, rolling 12-month logic, multiple-job integration and unpredictable-exceedance logic. Full runtime tests still need CI execution. |
| 4 | Multiple Minijobs | ✅ | `employmentType`, eligible-Minijob filtering and cross-engine tests are present. Production/E2E verification remains. |
| 5 | Separate Flex/Fest/Selbstständig income | ✅ | Explicit employment types and `isEligibleMinijobShift()` are present; Payroll/Legal integration uses eligible Minijob scope. |
| 6 | Illness / Entgeltfortzahlung | ⚠️ | `sickCaseId`, 42-day case limit and 28-day waiting period are implemented. Same-illness reset over 6/12-month statutory rules is not fully inferable from the stored model and needs legal/product verification. |
| 7 | Urlaubsentgelt | ✅ | 13-week model and overtime exclusion are implemented and tested at unit-test level. Full test run still required. |
| 8 | Default rate 13.50 → current legal rate | ✅ | `DEFAULT_SETTINGS.defaultRate = 13.9`; Bundesland default is NI. Historical 13.50 strings remain only in tests/templates/examples, not as default setting. |
| 9 | MiLoV4 → MiLoV5 | ✅ | `rules.ts` uses MiLoV5 for 2026/2027 and tests 13.90/14.60. |
| 10 | Impressum / Datenschutz / AI privacy | 🔴 | Routes exist, but Impressum/Datenschutz explicitly contain placeholders/unfinished legal text. Real provider identity and final legal/privacy wording still required before public release. |

## P1 / reliability and security

| # | Original audit item | Status | Current evidence / remaining action |
|---|---|---|---|
| 11 | Employment start/end | ✅ | `startDate`/`endDate` and active-on-date logic exist with tests. |
| 12 | 12-month prognosis | ⚠️ | Rolling 12-month legal calculations and forecast structures exist; a complete user-facing annual prognosis is not treated as fully production-verified. |
| 13 | Unpredictable exceedance tracking | ✅ | Exceedance state and tests exist. Production semantics still need final legal QA. |
| 14 | Multiple employment questionnaire | ⚠️ | Employment type is modeled; the original audit's explicit onboarding/questionnaire UX is not proven complete from code inspection. |
| 15 | Correct hours limit per Job | ✅ | Limits code uses job-specific effective rates where available and tests contain job-specific rate cases. |
| 16 | Bundesland onboarding | ⚠️ | Default is correctly NI, but whether onboarding forces/clearly obtains the user's Bundesland requires UI smoke test. |
| 17 | Account deletion | ⚠️ | Delete-account Edge Function and client flow exist; live deployment and real deletion of all cloud/local data require production verification. |
| 18 | Storage migrations / RLS | ⚠️ | Ownership/RLS and Storage hardening migrations exist. Production migration application and Security Advisor state cannot be confirmed from source alone. |
| 19 | Server-side file validation | ✅ | Upload Edge Function has auth, size, MIME/extension/magic-byte validation and ownership checks. Live deployment remains to be verified. |
| 20 | AI history limits | ✅ | History/context limits are implemented in current AI hardening. |
| 21 | Global/shared AI rate limit | ✅ | Shared Supabase `consume_ai_rate_limit()` exists; table privileges are revoked and RLS migration exists. Production migration state remains to be verified. |
| 22 | AI historical context | ⚠️ | Context hardening exists, but the exact historical range supported by current `buildAssistantContext()` needs final product verification. |
| 23 | Payment overdue | ✅ | Payment ledger has confirmed payments, open, overpaid and overdue logic based on earned/open amounts. |
| 24 | Expected / Earned / Paid separation | ✅ | Payment ledger and cross-engine statistics use distinct Expected/Earned/Paid/Open/Overpaid values. |

## Product / UX / QA

| # | Original audit item | Status | Current evidence / remaining action |
|---|---|---|---|
| 25 | Statistik redesign | ⚠️ | Payment summary and legal data are integrated, but full visual/product redesign is not production-smoke-tested. |
| 26 | Prognose UX | ⚠️ | Forecast/legal forecast infrastructure exists; final UX and end-to-end behavior require browser verification. |
| 27 | Arbeitszeitnachweis | ✅ | PDF Arbeitszeitnachweis exists with date, entry kind, start/end, pause, hours, work code, note, totals and signatures. |
| 28 | Branchenmindestlohn | ✅ | Versioned industry minimum wage engine and Dashboard warning integration exist. |
| 29 | Dashboard “Was ist heute wichtig?” | ⚠️ | Dashboard warning card exists and is mobile-hardened; complete visual smoke test remains outstanding. |
| 30 | Better Sync UI | ✅ | Sync status/last successful sync/local changes/cloud version/conflict states implemented. |
| 31 | Better Backup UI | ✅ | Backup state/content and local/cloud distinction implemented. |
| 32 | Duplicate-safe import | ✅ | Stable duplicate key, preview/count and confirm-time duplicate recheck exist. Replace/Merge modes remain product choices, not implemented. |
| 33 | Notification testing | ⚠️ | Midnight/delivery-state hardening exists; real Android/iOS/PWA/permission/offline matrix still needs device testing. |
| 34 | Midnight / DST | ⚠️ | Midnight calculations and calendar-day handling are hardened. Exact DST elapsed-time correctness is not fully representable because Shift stores local date + HH:mm without timezone/UTC timestamp. |
| 35 | Rounding audit | ✅ | Central money/hour rounding helpers and Payment Ledger boundary tests exist; full test/build execution still required. |
| 36 | Accessibility audit | ⚠️ | Existing accessibility settings/tests plus mobile hardening exist; full keyboard/screen-reader/contrast/charts audit requires live UI testing. |
| 37 | 360×800 mobile audit | ⚠️ | Mobile overflow/touch-target hardening exists; complete 360×800 browser smoke test remains outstanding. |

## Infrastructure / release gates not represented by the original 37 rows

| Gate | Status | Reason |
|---|---|---|
| Full TypeScript build | ⚠️ | `node_modules` is absent in the available workspace; Bun is unavailable. |
| Full Vitest suite | ⚠️ | Same dependency/runtime limitation. Tests exist but have not been executed as a complete suite. |
| Production browser smoke test | ⚠️ | Live production deployment could not be interactively verified from this environment. |
| Supabase Security Advisor | ⚠️ | Source migrations exist, but live dashboard configuration cannot be inferred from code. |
| Leaked Password Protection | ⚠️ | Account-level Supabase setting; not verifiable from current source tools. |
| Historical secret revocation | 🔴 | Requires owner action in Supabase/Git/Vercel and cannot be safely performed from source audit. |
| Final legal identity / provider data | 🔴 | Requires the real operator/provider information and final legal review. |

## Release conclusion

The application has moved substantially beyond the original P0 functional defects. The legal calculation core, payment ledger, employment scoping, import boundary, document workflow, sync/backup hardening, industry minimum wage, mobile hardening and notification time logic are represented in the current source tree.

It should **not yet be described as fully production-verified** because several release gates depend on live infrastructure, real devices, or owner-provided legal/security information. The remaining blockers are now predominantly release/operations/QA rather than the original calculation-engine architecture.
