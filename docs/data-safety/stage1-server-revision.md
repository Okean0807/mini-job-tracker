# Stage 1 – server-maintained backup revision (prepared, NOT applied)

Status: implemented and tested locally; **not applied to any remote database** (production migration
not approved; `minijob-preview-test` not used). Stage 2 (mandatory `x-expected-rev`, rejecting legacy
writes) is **not implemented and not approved**.

## Files

| File | Purpose |
|---|---|
| `supabase/pending/20261120000000_backups_server_revision.sql` | forward migration (outside the applied chain, like the other pending files) |
| `supabase/pending/rollback/20261120000000_backups_server_revision.rollback.sql` | rollback (staged procedure below) |
| `scripts/db-tests/rev_run.sh` | 47 checks on an isolated local PostgreSQL (socket only; refuses TCP) |
| `src/lib/minijob/cloud-cas.ts`, `cloud.ts` | client: revision CAS + old-schema fallback |
| `src/lib/minijob/sync-diagnostics.ts` | counter-only observability |

To apply later: move the forward file into `supabase/migrations/` with a version newer than the latest
applied one, after explicit approval, through a PR – never as ad-hoc SQL.

## What the migration does

* `public.backups_rev_seq` (bigint) starting at the current time in µs (~1.8e15 < 2^53, exact as a JSON
  number); `no cycle`; created `if not exists`.
* `backups.rev bigint not null default nextval(...)`: existing rows each receive their own value (one
  table rewrite; one row per account).
* `BEFORE INSERT OR UPDATE ... FOR EACH ROW` trigger `backups_set_rev`: `new.rev := nextval(...)` – on
  **every** insert/update by **any** role, including a legacy blind upsert and a write that does not
  touch `updated_at`. Client-supplied values are discarded.
* Function: `SECURITY INVOKER`, `SET search_path = ''`, all references schema-qualified
  (`pg_catalog.nextval`, `public.backups_rev_seq`), EXECUTE revoked from `public, anon, authenticated,
  service_role`. SECURITY DEFINER is **not** used: the column DEFAULT already needs `USAGE` on the
  sequence for the writing role, so the same minimal grant covers the trigger and no elevated function
  exists.
* Sequence privileges: `REVOKE ALL` from `public, anon, authenticated, service_role` (Supabase default
  privileges may have granted ALL), then `GRANT USAGE` to `authenticated, service_role` only. Verified:
  without USAGE an authenticated write fails with 42501 (so the grant is required); no role can
  `setval`; `anon` cannot draw revisions.
* Not `OWNED BY` the column: the rollback must not drop the sequence.
* RLS policy, table grants, FK/cascade (account deletion) untouched.

## Verified behaviour (`rev_run.sh`, PostgreSQL 16 locally; production runs 17)

Upgrade with existing rows (data unchanged, distinct valid revisions), idempotent re-run, insert/update
assign revisions, client-supplied `rev` ignored (insert, update, `ON CONFLICT DO UPDATE`), legacy upsert
and payload-only updates increment, DELETE+INSERT never reuses a revision, 8 concurrent updates →
8 distinct revisions (the sequence may skip numbers when a blocked writer's BEFORE trigger is re-fired
after the row lock – gaps are expected, reuse never), rev-CAS: exactly 1 of 8 racing writers wins
(15 rounds), concurrent inserts: 1 winner / 7 × 23505, `authenticated` and `service_role` writes
increment, RLS isolation, account-deletion cascade, search-path hijack (`public.nextval` shadow) has no
effect, rollback → old-schema behaviour → re-upgrade, recreated sequence still starts above old values.

## Client transition matrix

| Client | Schema without `rev` | Schema with `rev` |
|---|---|---|
| Older build (blind upsert) | works (unchanged) | works; its write bumps `rev` (now **detectable**) |
| Stage 1 build | first read gets `42703` naming `rev` → one retry without `rev`; `updated_at` CAS for the rest of the session | reads `rev`, CAS on `user_id` + `rev` |

Rules implemented (`cloud-cas.ts`, `cloud.ts`):
* Fallback only for a **confirmed** missing-column error: `42703` whose message names the column `rev`,
  or `PGRST204` naming `'rev'`. Another missing column, `42501`, network errors, `PGRST116` etc. are
  **not** fallback signals and surface as errors.
* The failed rev query wrote nothing (a missing column fails the whole statement), so exactly **one**
  repeat with the exact `updated_at` filter is safe – it is a new conditional write, not a blind retry
  of an ambiguous one. A write whose outcome is **ambiguous** (timeout/network) is never repeated.
* After the fallback `rev` is not requested again in that page session (no repeated probing); a new page
  load probes once (e.g. after the migration was applied). The stored `remoteRev` is cleared so a later
  re-migration cannot produce a false conflict from a stale revision.
* Revision values are kept as exact strings; only safe integers (≤ 2^53−1) are accepted, anything else
  is treated as "no revision" (then the `updated_at` filter applies) – never a rounded value.
* Conditional update: filter `user_id` + observed `rev`; exactly **one** returned row = success; zero
  rows = conflict (refetch/re-prepare, status `conflict`, no retry); no row → plain `insert`
  (`23505` → conflict, `23503` → account gone, `42501` → safe auth error).
* A changed revision is always a change, even when `updated_at` is identical (writer that does not
  advance the token).

## Rollback – staged procedure (a single `DROP COLUMN` is not enough)

1. Keep/ship the Stage 1 client first. Older clients never use `rev` and are unaffected; a Stage 1
   client that still asks for `rev` after the drop gets `42703` once and falls back (tested in
   `cloud.revision.test.ts` "Rollback" and at SQL level in `rev_run.sh` 8d–8f).
2. Apply the rollback file through the same channel as the forward change (new migration via PR).
3. Verify: no `rev` column; a manual backup from a current client succeeds on `updated_at`.
4. The **sequence is kept on purpose**: a later re-upgrade continues above every number issued
   (tested, 8i/9a). While rolled back, writes are not revision-tagged (detection falls back to the
   `updated_at` token with the blind spot described in `phase5-writer-inventory.md`).
Do not roll the database back under a client build that requires `rev` – no such build exists; the
Stage 1 client treats `rev` as optional.

## Observability (counters only)

`sync-diagnostics.ts` keeps per-account-scope **counts and last-event times** in `localStorage` (no
payload, PIN, ids or error text; capped; each distinct remote revision counted once per page load):
`cas-stale`, `remote-advanced`, `remote-advanced-token-flat`, `token-regression`, `rev-fallback`,
`ambiguous-write`.

* `remote-advanced-token-flat` = the revision rose but `updated_at` did not advance: current clients
  always advance the token, so this points to an older client with a skewed clock, a direct API call or
  an operator write.
* It cannot prove that a given write came from an older **build**: the database sees the same
  authenticated role and the same shape of write. Server-side attribution would need request metadata
  (e.g. a client-version header) – deliberately not introduced (no custom mandatory header in Stage 1).
* There is no UI for the counters yet (support/diagnostic use via `readSyncDiagnostics`).

## Remaining bypass risks (Stage 1 is detection, not prevention)

* Older builds, direct API callers and `service_role` can still overwrite; Stage 1 makes it
  **detectable** by current clients (conflict instead of silent overwrite), it does not stop it.
* Trigger bypass: `session_replication_role = replica`, `ALTER TABLE ... DISABLE TRIGGER`, restores that
  replay data without triggers (owner/superuser level only).
* A database restore to an earlier point can rewind revisions; the client never auto-applies an older
  `updated_at` token over newer local data (Phase 5 guard) and tokens/revisions are compared by
  inequality, not order.
* The behaviour against real PostgREST/Supabase (gateway, schema cache reload, `PGRST204` wording) is
  **not validated** – only real PostgreSQL semantics and the real `@supabase/postgrest-js` request
  shape are.
* `src/integrations/supabase/types.ts` was not regenerated (it would claim a column that production
  does not have yet); the client talks to `backups` through a structural type for this reason.
