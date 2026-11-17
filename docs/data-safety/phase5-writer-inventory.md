# Phase 5 – writers of `public.backups` and server-side enforcement

Scope: every code path (in this repository and by design of the platform) that can write the cloud
backup row. Method: repository-wide search for `backups`, `.upsert(`, `.insert(`, `.update(`,
`.delete(`, `.rpc(`, service-role clients, edge functions and migrations; plus platform/legacy
writers that exist outside the repository.

## Inventory

| # | Writer | Where | Auth context | CAS | Account isolation | Can overwrite newer data? | Bypasses Phase 4? |
|---|---|---|---|---|---|---|---|
| 1 | Auto/manual/conflict upload | `cloud.ts` `push()` → `cloud-cas.ts` `casWrite()` (callers: `autoSync`, `backupOperation.commit`) | end-user JWT (anon key + session), RLS `auth.uid() = user_id` | **yes** – `user_id` + exact `updated_at`; `insert` when no row; no upsert | client: `ownsLoadedData`/`stillOwner` + scope epoch; server: RLS | no (0 rows → conflict) | – (this is the guarded path) |
| 2 | Account deletion | `supabase/functions/delete-account/handler.ts` | **service_role**, `user.id` from the bearer token | no (delete, not overwrite) | `.eq("user_id", user.id)` | not applicable (removes the row) | not a data-overwrite risk; intentional |
| 3 | FK cascade | `backups.user_id → auth.users ON DELETE CASCADE` | database | no | by FK | not applicable | – |
| 4 | **Older app builds** (cached PWA bundles, old tabs, preview/previous deployments) | builds before Phase 4 called `supabase.from("backups").upsert({user_id, payload, updated_at})` (`cloud.ts` up to `1f89ad2`; introduced in `cf9c4ea`) | end-user JWT | **no** – blind upsert | RLS only | **yes** | **yes** |
| 5 | Any authenticated PostgREST caller (own scripts, third-party tools, DevTools) | `PATCH/POST /rest/v1/backups` | end-user JWT | **no** (server does not require it) | RLS only (own row) | **yes** (own row) | **yes** |
| 6 | Operators / tooling with `service_role` (dashboard SQL editor, MCP, migrations, other edge functions that might be added) | – | service_role, bypasses RLS | no | none | yes | yes |
| – | Reads | `cloud.ts` `fetchRemote()` only | end-user JWT | – | RLS | – | – |

No other writer exists in `src/`, `supabase/functions/` (only `delete-account` touches `backups`;
`upload-document` does not), database functions or triggers (the table has **no trigger**; the only
migrations touching it are `20260812221841…` and `20260930192515…`), TanStack server functions or
`client.server.ts` (service-role client; no `backups` access), and no RPC writes the table.

## What the real database shows (`scripts/db-tests/cas_run.sh`, local PostgreSQL 16)

* #4/#5 succeed: an authenticated blind `PATCH` without the CAS condition is accepted (case c9a).
* A payload change that does **not** touch `updated_at` is accepted and leaves the token unchanged
  (c9b): a token-based CAS cannot notice it. `updated_at` is client-controlled, so an old token value
  can be re-used (ABA, c9c). Older builds always write a fresh `updated_at`, so c9b/c9c only apply to
  non-standard writers – but the *blind overwrite itself* (c9a) applies to every older build.
* #6 bypasses RLS and any client check (c9d).

## Is server-side enforcement feasible without breaking existing clients?

**Detection (non-breaking): yes.** A server-maintained revision (`rev bigint`, bumped by a
`BEFORE INSERT OR UPDATE` trigger, never chosen by the client) makes *every* write visible to a
compare-and-swap client, including legacy blind writes (c9b/c9c become detectable). Old clients keep
working unchanged. Prototype: `docs/data-safety/proposed-backups-rev-trigger.sql`, exercised in a
throw-away local database by `cas_run.sh` (case cP). **Not applied to any Supabase project.**

**Prevention (stops legacy overwrites): only by breaking them.** Rejecting an `UPDATE` that does not
present the expected revision (PostgREST exposes request headers to SQL, or a `SECURITY INVOKER`
RPC + revoking direct `UPDATE`) turns every older build's save into an error. That is acceptable only
after older builds have retired (PWA `registerType: "autoUpdate"` helps but cannot reach devices that
never reopen the app). It also never constrains `service_role` (#6).

## Recommendation (needs a separate owner approval – no migration was written or applied)

1. Stage 1: add `rev` + trigger (additive, backwards compatible); ship a client that filters on `rev`
   in addition to `updated_at`. Roll out, then measure how many writes still arrive from older builds.
2. Stage 2 (optional, later): enforce the expected revision server-side once legacy traffic is gone.
3. Until then the honest statement is: *Phase 4 protects against concurrent writes by current clients;
   it does not protect against older builds, direct API callers or service-role writers.*
