# v1.0 release status and plan

Branch: `integration/variant-c-release-prep` (contains `release/v1.0-integration` of PR #146 plus 18 later commits).
Status date: 2026-10-26. Recorded facts only; every statement names how it was checked.

This file does not approve a merge, a deploy or a migration. Each of those needs a separate owner approval
naming the exact commit.

## Release point

"v1.0 open beta": users can sign up, record work, see limits and use the AI assistant. Public launch needs
all of the following:

1. One release commit with green CI (Vitest, TypeScript, XLSX boundary guard, Secret scan) and a passing build.
2. C-1, F-1 and the `ai_rate_limits` RLS migration applied to Production and verified by read-only catalog queries.
3. The AI assistant checked once against the real provider on Preview with a test user (answer, block, truncation, rate limit).
4. T6 and O-1 (sick-pay questions) decided by the owner or legal counsel, or the affected output marked as an estimate.
5. Impressum and Datenschutz completed with the operator's real data (see `docs/LEGAL_RELEASE_CHECKLIST.md`).
6. Rollback path known: previous Production deployment, migration rollbacks, log access without personal data.

A closed test with known users is possible after 1-3.

## State of the code (branch HEAD)

| Item                                                                                                                                                             | State                                                                                                                                                                                                        | Evidence                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| CI                                                                                                                                                               | green on `1aa6d03`                                                                                                                                                                                           | Vitest run 325, Secret scan run 61 |
| Build                                                                                                                                                            | passes                                                                                                                                                                                                       | `bun run build` exit 0             |
| Unit tests                                                                                                                                                       | all pass locally except `xlsx-version.test.ts`, which fails only because the sandbox has `xlsx@0.18.5` instead of the lockfile's 0.20.3 (same failure on the previous commit; CI installs 0.20.3 and passes) | local run, CI                      |
| DECISIONS R3 items (sick-case merging, long-gap threshold, hideable notice with revalidation, O4 per active month, annual export explanation, AI prompt wording) | implemented in commits `340478c`, `1a87a21`, `b05e85a`, `d455437`, `4e4b64c`; the PR #146 description still lists them as open                                                                               | `git log`                          |
| AI error handling (session vs provider errors, blocked, empty, truncated, `OTHER`)                                                                               | implemented and tested with stubs only                                                                                                                                                                       | `1aa6d03`                          |

## Production facts (read-only, 2026-10-26)

| Item                           | State                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase project               | `jauzsejxdfpnlgdtohuv`, 9 migrations, last `20260930192515`                                                                          |
| C-1 (`20261012160000`)         | not applied: all four `documents` policies exist                                                                                     |
| F-1 (`20261014100000`)         | not applied: function body still reads `p_now_ms`                                                                                    |
| `ai_rate_limits`               | RLS off, no policies, no `anon`/`authenticated` privileges                                                                           |
| Frontend in Production         | Vercel deployment from `7fcbd79`; documents are uploaded only through the `upload-document` Edge Function, never directly to Storage |
| Edge Functions                 | `upload-document` v3, `delete-account` v2                                                                                            |
| Migration auto-apply on `main` | not confirmed (Dashboard setting not readable); treat a merge that adds a file to `supabase/migrations/` as applying it              |

## Plan

| Stage | Work                                                                                                                                                                                          | Needs owner                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1     | Keep this branch as the single release line; correct the PR #146 description before any use of it                                                                                             | decision on PR #146                           |
| 2     | Preview check of the AI assistant with one test user; document upload, import and export smoke test                                                                                           | test user, small AI budget                    |
| 3     | Close T6 / O-1 and the legal pages                                                                                                                                                            | owner or counsel, operator data               |
| 4     | Migrations, one at a time, each its own PR with one file: C-1, then F-1, then RLS (RLS keeps version `20260930220000` only if applied before C-1 and F-1; otherwise it needs a newer version) | one approval per migration, naming the commit |
| 5     | Production deploy of the release commit; check Edge Function versions                                                                                                                         | approval naming the commit                    |
| 6     | 48 hours of log observation; no changes unless something fails                                                                                                                                | -                                             |

Stop conditions for every stage: Production read differs from the table above, a PR contains more files than
planned, `relforcerowsecurity` is true, or reading Production returns 403.
