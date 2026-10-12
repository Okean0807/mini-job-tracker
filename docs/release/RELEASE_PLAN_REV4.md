# Unified security release - plan rev.4 (2026-10-12, CEST)

Supersedes rev.3 (same directory). Merge, deploys, migrations and Vercel changes are NOT approved by this document. Each needs a separate explicit approval from Juri. The executor is never the approver. Gate names S0–S6 follow Juri's wording (QA R2 F-139-1).

## Gates (Juri's wording; the earlier rules are kept as sub-rules, none weaker than rev.3)

- **S0 — Access and identity**: correct Vercel scope, project and Production alias confirmed; otherwise STOP.
  - S0.1: the production deployment SHA must be readable via the connector. A 403 is a hard STOP at step 0 (rev.3 S0). Re-checked at step 9.
- **S1 — Code review**: current PR, diff and required checks confirmed.
  - S1.1: required checks `unit` + `gitleaks` green at the PR head; Supabase Preview SKIPPED is not a pass. Final QA is at the same head SHA.
  - S1.2 (multi-source migration check): git `supabase/migrations/` at the relevant SHA + `list_migrations` + live schema, at steps 1, 2, 6, 12. Any mismatch = STOP.
- **S2 — Merge authorization**: a separate explicit operator approval for the specific PR and HEAD SHA.
  - S2.1: the approval text must read `merge #138 @<full 40-char head SHA>`. If the PR head differs from that SHA at merge time → STOP (new approval needed).
  - S2.2: Juri approves; QA output is input only; the executor is never the approver.
- **S3 — Deployment authorization and execution**: a separate approval for the specific function and expected version.
  - S3.1: the approval names the function, merge SHA, file sha256s, verify_jwt=true and the expected version (baseline+1). Merge ≠ deploy.
  - S3.2: no `apply_migration`, no manual rollback.sql, no edits to applied migrations. Function rollback = redeploy of the pinned copy with its own approval.
- **S4 — Deployment verification**: version/source identity, updated_at if available, smoke tests and a re-check after 10 minutes.
  - S4.1: field-by-field status/version/updated_at/ezbr/get_edge_function source sha256 read after every merge and deploy (steps 2, 3, 14), each with a ≥10-min re-read; both reads saved. UNKNOWN/unreadable = STOP.
- **S5 — Migration review and authorization**: separate PR, independent migration review, recovery plan and separate approval.
  - S5.1: step 5 is hard-gated on step 3 (deploy verified) and step 4. An independent QA of the migration-PR diff is a precondition. Rollback = a new migration PR (content = pending/rollback, which equals 192515).
- **S6 — Post-release verification**: actual state, logs and expected functions, without assuming the result.
  - S6.1: evidence for every step is stored under /workspace/stat-analysis-report/delete-account-fix/release/step-00/… (step-NN) with CEST timestamps; SKIPPED/UNKNOWN/403 are never PASS.

Step mapping: S0→0,9 · S1→1,2,6,12 · S2→2 · S3→3 · S4→2,3,4,14 · S5→5,6,11,12 · S6→6–8,12–14,18,20.

## P3-B: preconditions for step 5 (hard gate on step 3) (all required; any missing → STOP)

1. Step 3 PASS: upload-document version = baseline+1, status ACTIVE, verify_jwt=true.
2. Both reads (immediately and ≥10 min later) equal in version/updated_at/ezbr.
3. get_edge_function source sha256 = git at the merge SHA for index.ts and handler.ts (a failed read = UNKNOWN = STOP).
4. The 0-byte smoke (P3-E) PASS.
5. Step 4 PASS (upload via the function works for the test user; test data cleaned).
6. delete-account unchanged vs the baseline.
7. S1 holds immediately before: list_migrations = 9 (or the known set), policies = 4 as in 192515.
8. S0 PASS (frontend no longer writes Storage directly; otherwise uploads from old builds break).
9. Independent QA of the migration-PR diff (file byte-equal to pending, version > last applied, no other files): PASS at the migration-PR head SHA.
10. Juri's separate approval for the migration PR (naming the PR and its head SHA).

## P3-E: 0-byte smoke (step 3)

- Request: `curl -sS -o body.json -w '%{http_code}' -H "Authorization: Bearer $TEST_JWT" -F 'file=@empty.pdf;type=application/pdf' -F folderId=<test folder uuid> (field name per handler.ts:137; the file field is `file`, handler.ts:123) $FN_URL/upload-document` with `: > empty.pdf` (the JWT is only from the env var, never printed).
- Expected HTTP: 400 `file-required` or 413 `file-too-large` (Deno may parse an empty part differently from Node; either is PASS; 2xx = FAIL).
- Then SQL by test uid: 0 storage.objects in `documents/<uid>/`, 0 `documents` rows; function logs show no upload/insert/cleanup event for the request; record the response, the log event ids and the run timestamp (CEST).
- Environment: there is NO non-production Supabase environment (list_projects = 1 project; list_branches = only the default `main` branch, which is prod). So the smoke runs in prod only with Juri's approval (test user created before the step-3 smoke, separate approval). A no-approval alternative is local only: run handler.ts under Deno with a real multipart Request and mocked deps. That covers parsing, not the deployed function.

## Steps 0–20

### Step 0: S0: prove which commit Vercel production runs

- Action: Read-only: list_teams, get_project, list_deployments and get_alias for mini-job-tracker in team_zxFeXiw1uOujblhu9GRRqsSF, via both Vercel connectors
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (only to accept the evidence; no Vercel change)
- Inputs: connector access to scope okean0807
- Evidence: raw responses with CEST timestamps; production deployment id and its git commit SHA → /workspace/stat-analysis-report/delete-account-fix/release/step-00/
- PASS: both connectors return the project and the production deployment SHA
- FAIL/STOP: any 403/404/empty → STOP, release BLOCKED — VERCEL SCOPE ACCESS NOT VERIFIED. Operator action: reconnect the Vercel connector and grant team access for okean0807. No bypass, no other route.
- Rollback: n/a (read-only)
- Next step only if: PASS of S0

### Step 1: Baseline snapshot (S1 input) + final QA input

- Action: Final QA at the PR head is input, not approval. Read-only: list_edge_functions, get_edge_function for both functions, list_migrations, pg_policies storage.objects, ai_rate_limits relrowsecurity/ACL, consume_ai_rate_limit prosecdef/proconfig/ACL
- Executor: UNASSIGNED — operator decision required
- Approver: none (read-only)
- Inputs: step 0 PASS
- Evidence: baseline.json: version, updated_at, ezbr_sha256, source sha256 (or 'get_edge_function failed' verbatim), 9 migrations, last 20260930192515, 4 policies → /workspace/stat-analysis-report/delete-account-fix/release/step-01/
- PASS: values equal QA_PR138_FINAL §6 and R2 §F
- FAIL/STOP: any drift → STOP, report to Juri
- Rollback: n/a
- Next step only if: baseline saved AND final QA PASS/PASS WITH NOTES at the same head SHA (P0/P1 or a changed head → STOP)

### Step 2: Merge #138 (P3-D: merge ≠ deploy)

- Action: Merge PR #138 (merge commit, no squash/rebase)
- Executor: UNASSIGNED — operator decision required
- Approver: Juri; approval text exactly `merge #138 @<full 40-char head SHA>`
- Inputs: steps 0–1 PASS; the PR head equals the approved 40-char SHA (otherwise STOP); CI unit+gitleaks green at the head; Supabase Preview is SKIPPED, which is not a pass
- Evidence: merge SHA, CI run URLs on main at the merge SHA, list_edge_functions + get_edge_function source sha256 read immediately and ≥10 min later (both saved), list_migrations, pg_policies → /workspace/stat-analysis-report/delete-account-fix/release/step-02/
- PASS: merge SHA recorded; CI green on it; both functions still v2 with identical status/updated_at/ezbr/source sha256 (baseline) in both reads; migrations still 9; policies 4. A green Vercel CI is NOT Edge Function evidence
- FAIL/STOP: PR head ≠ approved SHA, a source read UNKNOWN, any function field changed, a migration count change, unclear or unreadable values → STOP (no fix-forward)
- Rollback: revert PR (new PR; separate approval); an unexpected deploy → step 4 rollback
- Next step only if: all post-merge reads equal the baseline

### Step 3: Deploy upload-document from the merge SHA + verification (P3-A) + 0-byte smoke (P3-E)

- Action: deploy_edge_function name=upload-document, entrypoint index.ts, verify_jwt=true, files index.ts+handler.ts byte-equal to git at the merge SHA (sha256 recorded before the deploy)
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step) naming function, merge SHA, file sha256s, verify_jwt=true
- Inputs: step 2 PASS; BEFORE the smoke: the test user exists (created by Juri under its own separate approval) and the test JWT is in the env var (never printed); file sha256s from `git show <merge>:supabase/functions/upload-document/{index,handler}.ts | sha256sum`
- Evidence: deploy response (version, ezbr); read #1 right after + read #2 ≥10 min later: status, version, updated_at (list_edge_functions provides updated_at as epoch ms → CEST), ezbr_sha256, get_edge_function source sha256 per file; both reads saved; smoke log → /workspace/stat-analysis-report/delete-account-fix/release/step-03/
- PASS: status ACTIVE; version = baseline+1; updated_at > merge time; ezbr equals the deploy response in both reads; source sha256 = git at the merge SHA for both files; verify_jwt=true; delete-account unchanged; 0-byte smoke PASS
- FAIL/STOP: ezbr differs between reads, source hash ≠ git, get_edge_function fails (the source hash is UNKNOWN; UNKNOWN ≠ PASS → STOP), version jump >1, delete-account changed, smoke fails → STOP
- Rollback: redeploy /workspace/stat-analysis-report/supabase-drift/edge/upload-document/rollback-pinned/index.ts (sha256 2fd002ba…f9b9e) with verify_jwt=true; separate approval by Juri
- Next step only if: every field PASS in both reads + smoke PASS

### Step 4: Post-deploy contract probes + upload smoke with the step-3 test user

- Action: OPTIONS 200, no-JWT 401, GET 405; the same test user (precondition of step 3) uploads a PDF via the app/function; object + row verified; delete-account cleans up
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step) (test user in prod)
- Inputs: step 3 PASS
- Evidence: statuses, function logs (no cleanup-failed, no PII), SQL counts by test uid before/after → /workspace/stat-analysis-report/delete-account-fix/release/step-04/
- PASS: all statuses as expected; object+row created then removed; non-test counts = baseline
- FAIL/STOP: 5xx, leaked error text, non-test data change → STOP
- Rollback: step 3 rollback; delete-account for the test user
- Next step only if: PASS

### Step 5: Migration PR: move 20261012160000 into supabase/migrations/ (merge = prod apply). HARD-GATED ON STEP 3 (P3-B)

- Action: New PR moving the file (version > 20260930192515); the content is byte-equal to pending
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step) (separate from merge/deploy approval)
- Inputs: P3-B checklist incl. independent migration-diff QA; ALL must be PASS
- Evidence: checklist with evidence links → /workspace/stat-analysis-report/delete-account-fix/release/step-05/
- PASS: every precondition PASS
- FAIL/STOP: ANY precondition not PASS/UNKNOWN → STOP (see P3-B list)
- Rollback: n/a before merge
- Next step only if: merged

### Step 6: Post-apply 3-source check (S1)

- Action: git migrations at the merge SHA, list_migrations, live pg_policies
- Executor: UNASSIGNED — operator decision required
- Approver: none (read-only)
- Inputs: step 5 merged
- Evidence: 3 reads → /workspace/stat-analysis-report/delete-account-fix/release/step-06/
- PASS: list_migrations has exactly the new version/name; storage.objects policies = SELECT+DELETE only; git = live
- FAIL/STOP: any mismatch → STOP
- Rollback: new migration PR re-creating policies from pending/rollback (= 192515), separate approval; no manual rollback.sql
- Next step only if: PASS

### Step 7: Direct-write denial smoke

- Action: With a throwaway test JWT: direct Storage POST/PUT to documents → 403; upload via the function works
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step)
- Inputs: step 6 PASS
- Evidence: HTTP statuses, run ids, object counts → /workspace/stat-analysis-report/delete-account-fix/release/step-07/
- PASS: POST/PUT 403; function upload 200; cleanup done
- FAIL/STOP: direct write succeeds or the function upload fails → STOP
- Rollback: step 6 rollback PR
- Next step only if: PASS

### Step 8: Test-data cleanup verification

- Action: delete-account for the test users; SQL counts
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step)
- Inputs: step 7
- Evidence: counts by uid = 0; non-test counts = baseline → /workspace/stat-analysis-report/delete-account-fix/release/step-08/
- PASS: clean
- FAIL/STOP: residue → STOP
- Rollback: delete-account rerun (approval)
- Next step only if: clean

### Step 9: Frontend confirmation (S0 again)

- Action: Read-only: production deployment SHA on Vercel contains no client Storage writes (= main ≥ merge SHA)
- Executor: UNASSIGNED — operator decision required
- Approver: none
- Inputs: Vercel access
- Evidence: deployment SHA + git ancestry → /workspace/stat-analysis-report/delete-account-fix/release/step-09/
- PASS: prod SHA descends from the merge SHA
- FAIL/STOP: 403 or older SHA → STOP
- Rollback: n/a
- Next step only if: PASS

### Step 10: Decision: ai_rate_limits RLS migration (20260930220000, pending)

- Action: Decide whether to move it in a separate PR
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step)
- Inputs: #136 audit doc
- Evidence: decision record → /workspace/stat-analysis-report/delete-account-fix/release/step-10/
- PASS: decision recorded
- FAIL/STOP: no decision → stop here (release can close without it)
- Rollback: n/a
- Next step only if: decision = go

### Step 11: ai_rate_limits migration PR (merge = apply)

- Action: Move the file with a new version > the last applied
- Executor: UNASSIGNED — operator decision required
- Approver: Juri, explicit operator approval naming the exact migration PR number and its full 40-char HEAD SHA (`merge #<PR> @<40-char SHA>`)
- Inputs: step 10 go; (1) independent QA of the actual migration-PR diff (file byte-equal to pending, version > last applied, no other files), result recorded with an evidence link; (2) the explicit operator approval above, naming the exact PR and full 40-char HEAD SHA
- Evidence: PR, independent QA report link, approval text, PR HEAD SHA at merge time, merge SHA → /workspace/stat-analysis-report/delete-account-fix/release/step-11/
- PASS: independent QA recorded as PASS at the PR HEAD; approval names that exact PR + HEAD SHA; merged at that SHA
- FAIL/STOP: CI red → STOP; independent QA missing/incomplete/not PASS → STOP; approval missing or not naming the PR + full SHA → STOP; PR HEAD SHA ≠ approved SHA → STOP (new QA + approval needed)
- Rollback: new migration PR disabling RLS (approval)
- Next step only if: merged

### Step 12: Post-apply check (S1)

- Action: git supabase/migrations at the merge SHA, list_migrations, relrowsecurity, ACLs, consume_ai_rate_limit prosecdef/search_path/anon EXECUTE false
- Executor: UNASSIGNED — operator decision required
- Approver: none
- Inputs: step 11
- Evidence: 3 reads → /workspace/stat-analysis-report/delete-account-fix/release/step-12/
- PASS: RLS on; grants unchanged; function unchanged
- FAIL/STOP: mismatch → STOP
- Rollback: step 11 rollback PR
- Next step only if: PASS

### Step 13: AI feature smoke

- Action: rate-limit RPC via the app as a test user
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step)
- Inputs: step 12 PASS
- Evidence: statuses, logs → /workspace/stat-analysis-report/delete-account-fix/release/step-13/
- PASS: RPC works; limit is enforced
- FAIL/STOP: errors → STOP
- Rollback: step 11 rollback PR
- Next step only if: PASS

### Step 14: Re-read functions (S4 drift)

- Action: list_edge_functions + get_edge_function source sha256 after all merges, re-read ≥10 min later (both saved)
- Executor: UNASSIGNED — operator decision required
- Approver: none
- Inputs: step 13
- Evidence: two reads → /workspace/stat-analysis-report/delete-account-fix/release/step-14/
- PASS: only the step 3 version change; source sha256 = git at the merge SHA in both reads; an UNKNOWN read is not PASS
- FAIL/STOP: any other change → STOP
- Rollback: step 3 rollback
- Next step only if: PASS

### Step 15: Ruleset check

- Action: Read required checks (currently unit + gitleaks are required)
- Executor: UNASSIGNED — operator decision required
- Approver: Juri for any change
- Inputs: —
- Evidence: ruleset JSON → /workspace/stat-analysis-report/delete-account-fix/release/step-15/
- PASS: as expected
- FAIL/STOP: unexpected → report
- Rollback: revert ruleset (approval)
- Next step only if: PASS

### Step 16: Source PR housekeeping

- Action: Decide close/keep for #135/#136/#137
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step)
- Inputs: step 15
- Evidence: decision → /workspace/stat-analysis-report/delete-account-fix/release/step-16/
- PASS: recorded
- FAIL/STOP: —
- Rollback: reopen
- Next step only if: done

### Step 17: Docs update

- Action: Mark migrations applied / function deployed in the docs (docs PR)
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (explicit chat approval naming this step) for the merge
- Inputs: steps 0–16
- Evidence: PR → /workspace/stat-analysis-report/delete-account-fix/release/step-17/
- PASS: merged
- FAIL/STOP: —
- Rollback: revert PR
- Next step only if: done

### Step 18: 24h follow-up

- Action: Read-only: function logs for errors / cleanup-failed; versions unchanged
- Executor: UNASSIGNED — operator decision required
- Approver: none
- Inputs: 24h after step 3
- Evidence: log query output → /workspace/stat-analysis-report/delete-account-fix/release/step-18/
- PASS: no errors, no drift
- FAIL/STOP: errors/drift → STOP, report
- Rollback: step 3/6 rollback (approval)
- Next step only if: PASS

### Step 19: Rollback-readiness review

- Action: Confirm the rollback artifacts still exist and match their recorded hashes: pinned function copy, pending/rollback SQL = 192515
- Executor: UNASSIGNED — operator decision required
- Approver: none
- Inputs: step 17
- Evidence: sha256 reads → /workspace/stat-analysis-report/delete-account-fix/release/step-19/
- PASS: hashes match
- FAIL/STOP: missing/changed → open item, report
- Rollback: n/a
- Next step only if: PASS

### Step 20: Close-out record

- Action: Final record of SHAs, versions, migrations and evidence paths
- Executor: UNASSIGNED — operator decision required
- Approver: Juri (acknowledge)
- Inputs: all
- Evidence: release/FINAL.md → /workspace/stat-analysis-report/delete-account-fix/release/step-20/
- PASS: complete
- FAIL/STOP: missing evidence → open item
- Rollback: n/a
- Next step only if: end
