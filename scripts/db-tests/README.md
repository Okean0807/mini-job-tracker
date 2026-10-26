# Isolated DB tests (F-1 / RLS) — not part of CI

These scripts test `consume_ai_rate_limit` against a **throwaway local
PostgreSQL cluster**. They never use a remote database: the cluster is created
in a fresh `mktemp` directory, listens on a Unix socket only
(`listen_addresses = ''`, peer auth, no TCP), and the runner aborts (exit 3)
if the endpoint is not exactly that socket and data directory.

## Requirements

- PostgreSQL server binaries (`initdb`, `pg_ctl`, `postgres`) and `psql`;
  pass the bin directory as `PG_BIN`.
- `EXPECT_VERSION` must equal `current_setting('server_version')` **exactly**.
  The author run used `17.6`; distro builds include a suffix, e.g.
  `16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)`. A mismatch blocks the run before any test.
- Run as a **non-root** OS user (`initdb` refuses root). The user needs read access
  to the repository checkout and write access to `EVIDENCE_DIR` and `/tmp`.
- A git checkout (the runner records `HEAD` and the dirty count).

## Runs

```bash
# F-1 only (static guard: src/lib/security/ai-rate-limit-server-clock.test.ts)
PG_BIN=/usr/lib/postgresql/17/bin EXPECT_VERSION=17.6 EVIDENCE_DIR=/tmp/ev \
  scripts/db-tests/f1_isolated_run.sh

# F-1 + pending RLS for ai_rate_limits, with an explicit relrowsecurity assertion
PG_BIN=/usr/lib/postgresql/17/bin EXPECT_VERSION=17.6 EVIDENCE_DIR=/tmp/ev \
  scripts/db-tests/f1_rls_isolated_run.sh

# Direct access to ai_rate_limits by anon/authenticated (privileges_assert.sql);
# f1 = state Production gets on merge (RLS off), f1+rls = with the pending RLS migration
PG_BIN=/usr/lib/postgresql/17/bin EXPECT_VERSION=17.6 EVIDENCE_DIR=/tmp/ev \
  scripts/db-tests/ai_rate_limits_access_run.sh f1
PG_BIN=/usr/lib/postgresql/17/bin EXPECT_VERSION=17.6 EVIDENCE_DIR=/tmp/ev \
  scripts/db-tests/ai_rate_limits_access_run.sh f1+rls
```

Expected: `== RESULT pr140=0 extra=0 bypass_burst=0` (the old function's bypass is
reproduced first: "F-1 reproduced - 20/20 extra calls allowed via p_now_ms"); the
RLS run additionally prints `RLS_ASSERT_OK relrowsecurity=true policies=0` and
`rls_assert ok=<n>`. The access run prints `PRIV_ASSERT_OK denied=12/12 …` and
`access test (<mode>) passed`.

## Cleanup

- `f1_isolated_run.sh` stops the cluster and removes **only** the run directory it
  created (marker file + `/tmp/f1run-*` prefix checked), also on errors/Ctrl-C
  (`trap … EXIT`). Server and run logs are copied to `EVIDENCE_DIR` first.
- `f1_rls_isolated_run.sh` and `ai_rate_limits_access_run.sh` remove their temporary
  combined SQL directory (`/tmp/f1rls-*`, `/tmp/f1priv-*`) on exit.
- Known residue: if `pr140_run.sh` aborts in the middle of a burst, small
  `/tmp/pr140_b_<pid>_*` result files (`t`/`f`) can remain; the cluster itself is
  still removed.

## Recorded runs

| Date | PostgreSQL | Script | Result |
|---|---|---|---|
| 2026-10-15 | 17.6 | `f1_isolated_run.sh` (author run, t604) | see commit 08e3874 |
| 2026-10-26 | 16.15 (Ubuntu) | `f1_isolated_run.sh` | 39 PASS / 0 FAIL, old bypass reproduced |
| 2026-10-26 | 16.15 (Ubuntu) | F-1 + RLS + `rls_assert.sql` | 39 PASS / 0 FAIL, RLS on, 0 policies |
| 2026-10-26 | 17.6 (server from npm `@embedded-postgres/linux-x64@17.6.0-beta.15`, psql 16.15) | `f1_isolated_run.sh` | 39 PASS / 0 FAIL, old bypass reproduced |
| 2026-10-26 | 17.6 (same) | F-1 + RLS + `rls_assert.sql` | 39 PASS / 0 FAIL, RLS on, 0 policies |
| 2026-10-26 | 17.6 (same) | fail-closed checks | RLS disabled → 1, extra policy → 1, `EXPECT_VERSION=17.5` → 3, root → 2 |
| 2026-10-26 | 16.15 and 17.6 | `ai_rate_limits_access_run.sh f1` and `f1+rls` | 4 runs: 39 PASS / 0 FAIL each, `PRIV_ASSERT_OK denied=12/12` (2 databases per run) |
| 2026-10-26 | 17.6 | access test, injected defects | each → exit 1: GRANT SELECT to authenticated; GRANT SELECT to PUBLIC; column UPDATE; EXECUTE to anon; DELETE via an inherited role; SECURITY INVOKER |
| 2026-10-26 | 17.6 | access test, fail-closed | root → 2, bad mode → 2, `EXPECT_VERSION=17.5` → 3, SIGTERM mid-run → cluster stopped, no `/tmp/f1run-*` / `/tmp/f1priv-*` left |

## What the access run proves (privileges_assert.sql)

- `anon` and `authenticated`: no SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
  on `ai_rate_limits`, no column-level privileges, not superuser/BYPASSRLS
  (`has_*_privilege` includes PUBLIC and inherited role grants); no PUBLIC entry in
  the table or function ACL.
- Six direct statements per role (select, select … for update, insert, update,
  delete, truncate) really fail with 42501.
- `consume_ai_rate_limit(uuid,bigint)`: SECURITY DEFINER, owned by the table owner,
  `search_path=public`; `anon` cannot execute it; `authenticated` gets `allowed=true`
  for the token user and `forbidden` for another user id.
- All behavioural side effects are rolled back; the run fails if table state changed.

Assumption: the stub (`pr140_stub.sql`) reproduces Supabase's API roles and its default
privileges (`grant all on tables to anon, authenticated, service_role`), so the
`revoke` in `20260930192406` is what is tested. It does not query a real project;
`service_role` keeps full table access by design (server-side key only).

## What the RLS run does and does not prove

It proves that `consume_ai_rate_limit` (SECURITY DEFINER, owner `postgres`) keeps
working with RLS enabled and no policies, and that RLS is really on. It does **not**
prove the direct-table privileges of `anon`/`authenticated` (the owner bypasses RLS);
that is what `ai_rate_limits_access_run.sh` (above) tests.
