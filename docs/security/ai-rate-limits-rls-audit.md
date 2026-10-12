# ai_rate_limits — RLS audit (read-only, Production `jauzsejxdfpnlgdtohuv`, 2026-10-12)

Status: finding documented; fix already exists as
`supabase/pending/20260930220000_p1_ai_rate_limit_rls.sql` (NOT applied). No new migration.

| #   | Check                      | Result (evidence)                                                                                                                                                                                    |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Columns / PK               | user_id uuid PK, minute_stamps bigint[], hour_stamps bigint[], updated_at timestamptz                                                                                                                |
| 2   | FK                         | user_id -> auth.users ON DELETE CASCADE (confdeltype c)                                                                                                                                              |
| 3   | RLS                        | relrowsecurity = false, force = false, 0 policies                                                                                                                                                    |
| 4   | Table grants               | relacl `{postgres=arwdDxtm, service_role=arwdDxtm}`; anon/authenticated: none (`has_table_privilege` false)                                                                                          |
| 5   | API reachability (anon)    | 16:30 CEST `GET /rest/v1/ai_rate_limits?select=updated_at&limit=1` with anon key -> HTTP 401, `42501 permission denied` (safe read only, no writes)                                                  |
| 6   | authenticated reachability | not probed with a user JWT; grants show no privilege -> same 42501 expected (inference)                                                                                                              |
| 7   | Access path                | `consume_ai_rate_limit(uuid,bigint)` SECURITY DEFINER, search_path=public, owner postgres, EXECUTE: postgres, service_role, authenticated; checks `auth.uid() = p_user_id`                           |
| 8   | Service-role paths         | service_role has full privileges (bypasses RLS anyway)                                                                                                                                               |
| 9   | Default ACL risk           | `pg_default_acl` for postgres/supabase_admin in `public` grants arwdDxtm to anon/authenticated on NEW tables; a future `GRANT`/recreate of this table would expose it immediately because RLS is off |
| 10  | Pending migration vs live  | only `alter table ... enable row level security`; table owner = function owner = postgres and no FORCE -> SECURITY DEFINER function keeps working; no policies needed for clients                    |
| 11  | Delete-account             | row removed by CASCADE on deleteUser; not deleted directly by the function                                                                                                                           |

Classification: **no proven exploit** (grants revoked, API returns 42501). **Potential** (defense in depth):
exposure on any accidental re-grant. Severity low.

Recommended (separate approval): move the pending file into `supabase/migrations/`
with a version > `20260930192515`, apply, verify `relrowsecurity = true`, smoke-test the AI feature
(rate limit still enforced). Rollback: `alter table public.ai_rate_limits disable row level security;`.
