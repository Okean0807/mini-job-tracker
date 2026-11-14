# Release master plan — Minijob Companion

Maintained during release preparation. A row is DONE only with evidence (merged PR, test run, or a recorded manual check).
Status values: OPEN, IN PROGRESS (PR open), BLOCKED (owner or access dependency), DONE, DEFERRED, CLOSED (no action needed).

Last updated: 2026-11-14, against `main` @ `4190d58ee35f56474b8ca23728e542ee23755a59`.

## 1. Current state

- **Production** = `main` @ `4190d58` (Vercel project `mini-job-tracker`, deployment `dpl_FxN9ykkLeSNbJ6g8T8kfTJ6r7sWV`, READY). Merging into `main` deploys to Production automatically.
- **Open work PRs:** #165 (K2, WorkTimer validation, head `f221252`), #166 (K1, rate precision, head `0998609`), #167 (default rate by date, this plan's first change). Many older draft PRs (#142–#162) are not merged; their status is tracked in section 3.
- **CI:** `Vitest` (`bun run test`) and `Secret scan` (gitleaks) run on PRs. There is no CI job for typecheck, build, lint, or accessibility. The Vercel project `mini-job-tracker-public-local` fails every build (missing Supabase variables in that project); it is unrelated to code.
- **Supabase Production** (`jauzsejxdfpnlgdtohuv`): 11 migrations applied and equal to the repository; RLS on `backups`, `documents`, `document_folders`; storage writes only through the `upload-document` function; Security Advisor shows two warnings (see blockers).
- **AI** is disabled in Production and Preview (`AI_FEATURES_ENABLED` unset).

## 2. Findings register

| ID | Topic | Priority | Status | PR / evidence | Owner dependency |
|---|---|---|---|---|---|
| K1 | Hourly-rate precision, exact-value hint, explicit accept | P1 | IN PROGRESS | #166; local suite green, CI green on head; browser QA of Preview not yet done | Preview QA by a person with browser access |
| K2 | WorkTimer bypasses entry validation | P1 | IN PROGRESS | #165 | merge authorization |
| AUD-07 | Default rate static 13,90 € (14,60 € from 01.01.2027) | P1, due before 2027-01-01 | IN PROGRESS | #167 | merge authorization |
| AUD-17 | Datenschutz text not final; no terms of use | P0 | BLOCKED | `docs/legal/*_ENTWURF.md` drafts exist | owner and legal review |
| ABS-01..08, AUD-09, AUD-10 | Neutral "Abwesend", remove sick/vacation formulas | P0 (cloud launch) | OPEN | design in the review of 2026-11-10 | owner decisions (see blockers) |
| NEW-01 | Job chip overwrites a stored or typed rate | P1 | OPEN | cause: `ShiftDialog.tsx` job button handler | semantics to confirm |
| AUD-34 | JSON restore replaces all data without confirmation | P1 | OPEN | branch `fix/json-restore-safety` (draft PR #155) not merged | none |
| AUD-39 | Industry minimum wage data (care shifted a year; cleaning ends 2026-12-31 silently treated as compliant) | P1 | OPEN | needs primary-source check | source access |
| AUD-03 | Limit exactly at 603 € reported as exceeded; wording | P1 | OPEN | | none |
| AUD-11 | Part-year employment: limit not pro-rated | P1 | OPEN | | legal confirmation of the rule |
| JOB-01 | Monthly-pay Minijob: earnings follow day count | P1 | OPEN | | owner decision |
| AUD-14 | Austria/Switzerland selectable, German rules applied | P1 | OPEN | | none |
| AUD-40 / AUD-33 | Work-time PDF totals and CSV export mix absence rows into worked hours | P1 | OPEN | | none |
| AUD-24 | Photos and generated documents share localStorage quota | P2 | OPEN | branch `phaseD1/gps-privacy` has IndexedDB storage | none |
| AUD-36 / AUD-35 / AUD-38 | Two-account, two-device and iOS/Android manual checks | P1 | BLOCKED | | person with devices |
| AUD-01 | Old publishable key in Git history | P3 | BLOCKED | key is of a different, older project | owner confirms old project is gone |
| AUD-02 | `xlsx` 0.18.5 (write-only use) | P2 | OPEN | boundary script exists but is not run in CI | none |
| AUD-37 | `lang` attribute fixed to `de`; no automated a11y check | P2 | OPEN | | none |
| AUD-06, 19, 20, 22, 23, 26 | Closed or fixed in current code | — | CLOSED | review 2026-11-10 | — |

## 3. Pre-existing unmerged branches (decide per branch)

`fix/json-restore-safety` (#155), `fix/default-rate-current-milo` (#143, superseded by #167), `fix/sick-pay-continuous-case` (#144), `fix/limit-card-multiple-minijobs-warning` (#145), `fix/ai-context-minijob-earnings` (#142), `phaseD1/gps-privacy`, `feat/feedback*`, integration branches `integration/*`, `release/v1.0-integration`. None is merged; several overlap in files. Do not merge any without a fresh rebase check and CI run.

## 4. Implementation sequence

1. #167 default rate (time-critical, small).
2. K2 (#165) and K1 (#166): merge order K2, then K1, each in a controlled window; re-run CI on the combined result.
3. NEW-01 on top of K1.
4. AUD-34 safe restore (reuse draft #155), then schema version.
5. AUD-03 / AUD-32 limit edge cases; AUD-14; AUD-40 / AUD-33.
6. AUD-11 and JOB-01 after the legal rule is confirmed.
7. Abwesend (ABS) with migration, before any public launch that includes the cloud.
8. AUD-39 once the care and cleaning minimums are verified against primary sources.
9. Manual QA matrix (devices, accounts) and release documentation.

## 5. Quality gates (current evidence)

| Gate | Evidence | Status |
|---|---|---|
| Vitest | CI on #166: green; local `main` + K1 + K2 combined: 173 files, 2075 tests | PASS (local and CI) |
| TypeScript, build | local only; not in CI | PASS locally |
| ESLint | `eslint .` fails on `main` in untouched files (prettier); changed files compared against base per PR | NOT A GATE YET |
| Secret scan | CI gitleaks green | PASS |
| Browser E2E | local Playwright scripts only, not in the repository | NOT IN CI |
| Preview browser QA | blocked for the automated QA environment | BLOCKED |
| Accessibility | heuristic check only | NOT RUN (axe) |
| Production smoke | not run | NOT RUN |
