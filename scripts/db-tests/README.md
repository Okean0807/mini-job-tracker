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
```

Expected: `== RESULT pr140=0 extra=0 bypass_burst=0` (the old function's bypass is
reproduced first: "F-1 reproduced - 20/20 extra calls allowed via p_now_ms"); the
RLS run additionally prints `RLS_ASSERT_OK relrowsecurity=true policies=0` and
`rls_assert ok=<n>`.

## Cleanup

- `f1_isolated_run.sh` stops the cluster and removes **only** the run directory it
  created (marker file + `/tmp/f1run-*` prefix checked), also on errors/Ctrl-C
  (`trap … EXIT`). Server and run logs are copied to `EVIDENCE_DIR` first.
- `f1_rls_isolated_run.sh` removes its temporary combined SQL directory on exit.
- Known residue: if `pr140_run.sh` aborts in the middle of a burst, small
  `/tmp/pr140_b_<pid>_*` result files (`t`/`f`) can remain; the cluster itself is
  still removed.

## Recorded runs

| Date | PostgreSQL | Script | Result |
|---|---|---|---|
| 2026-10-15 | 17.6 | `f1_isolated_run.sh` (author run, t604) | see commit 08e3874 |
| 2026-10-26 | 16.15 (Ubuntu) | `f1_isolated_run.sh` | 39 PASS / 0 FAIL, old bypass reproduced |
| 2026-10-26 | 16.15 (Ubuntu) | F-1 + RLS + `rls_assert.sql` | 39 PASS / 0 FAIL, RLS on, 0 policies |
