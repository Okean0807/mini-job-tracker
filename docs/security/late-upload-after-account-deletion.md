# Late upload after account deletion (design note)

Status: proposal. Migration is in `supabase/pending/` and is NOT applied.

## Facts (read-only, Production `jauzsejxdfpnlgdtohuv`, 2026-10-12)

- `storage.objects` policies for bucket `documents` (role `authenticated`):
  SELECT / INSERT / UPDATE / DELETE, all `auth.uid()::text = (storage.foldername(name))[1]`.
- They check only the JWT `sub`, not whether the user still exists.
- Integration test Round 4 (2026-10-12 16:22 CEST): after a successful
  `delete-account`, the same access JWT still passed the Functions gateway
  (handler answered 401 because `auth.getUser` -> `user_not_found`).
  So an access JWT stays cryptographically valid until `exp`.
- App code never writes to Storage directly: `src/lib/minijob/documents.ts`
  uses `createSignedUrl` and `remove` only; uploads go through
  `upload-document` (service role, `auth.getUser` first, FK-protected
  `documents` insert, rollback `remove` on insert failure).
- `storage.objects.owner` has no FK to `auth.users`.

## Scenario

User deletes account while a client (malicious or a stale tab) still holds the
access JWT. Until `exp`, the client can `PUT/POST /storage/v1/object/documents/<uid>/...`
directly. Result: orphan object (no user, no `documents` row), counted against storage.
Not a cross-user data leak (prefix is the deleted user's own uid).

## Options

| Option                                                                       | Closes                                                | Residual                                                                                                           | User impact                           | Change              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------- |
| A. Drop INSERT+UPDATE policies (pending migration)                           | direct client writes at any time, incl. post-deletion | `upload-document` race: getUser before deleteUser, upload after -> FK insert fails -> object removed (best effort) | none (app does not use direct writes) | 1 pending migration |
| B. Policy `with check` + SECURITY DEFINER `user_exists(auth.uid())`          | post-deletion direct writes                           | direct writes still allowed while alive (bypass upload-document validation)                                        | none                                  | function + policy   |
| C. `auth.admin.signOut(jwt,'global')` in delete-account                      | refresh tokens                                        | access JWT still valid until exp                                                                                   | none                                  | code                |
| D. Shorter JWT expiry                                                        | shrinks window                                        | window remains                                                                                                     | more refreshes                        | settings            |
| E. Periodic orphan sweep (service role, objects whose uid not in auth.users) | any orphan eventually                                 | delayed                                                                                                            | none                                  | scheduled job       |

Recommendation: A (smallest, also enforces that uploads pass server-side
content validation). Optionally E later as a safety net.

## Migration plan (after explicit approval only)

1. Re-read live policies; record baseline.
2. Move the pending file into `supabase/migrations/` with a version newer than
   the last applied (`20260930192515`), merge via PR, let the integration apply it
   (or `apply_migration` with approval).
3. Verify: `pg_policies` for `storage.objects` shows only SELECT and DELETE.
4. Smoke: upload via app (upload-document) works; direct `POST /storage/v1/object/documents/<uid>/x`
   with a user JWT returns 403 (only with a throwaway test user, separate approval).

Note: the Round 4 integration test seeded objects through the direct Storage API.
After option A, future runs must seed via `upload-document`.

## Rollback (C1)

`supabase/pending/rollback/20261012160000_p2_documents_no_direct_client_write.rollback.sql`
re-creates both policies exactly as in the last applied definition,
`supabase/migrations/20260930192515_p1_rls_performance_hardening.sql` (lines 32-39):
`(select auth.uid())::text = (storage.foldername(name))[1]` (initPlan form).

| Source                                     | INSERT / UPDATE predicate                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 20260930192403 (older)                     | `auth.uid()::text = (storage.foldername(name))[1]` (bare call)                            |
| 20260930192515 (later, applied)            | `(select auth.uid())::text = ...`                                                         |
| Live `pg_policies` (read-only, 2026-10-12) | `((( SELECT auth.uid() AS uid))::text = (storage.foldername(name))[1])` -> matches 192515 |

The earlier version of this note pointed to 192403; that was imprecise (semantically equal,
but not the current definition). The test checks rollback == 192515 (whitespace-normalised).

## Affected clients (C3)

- Direct client uploads were removed in commit `a8d502335c247377050ab4abf8beb032e39c69fb`
  ("Phase 17 audit hardening", 2026-10-01 22:10 CEST): `uploadDocument` switched from
  `supabase.storage.from(BUCKET).upload(...)` + client insert to `functions.invoke("upload-document")`.
- After applying the migration, only builds **older than a8d5023** (e.g. a stale PWA cache or an
  old Vercel deployment URL) would get **403** on upload. Current builds are unaffected.
- Evidence: the current production bundle of `mini-job-tracker-blue.vercel.app` (48 JS chunks
  fetched read-only, 2026-10-12) references `upload-document` (chunk `dokumente-*.js`) and contains
  no `.from(x).upload(` / `createSignedUploadUrl` / `uploadToSignedUrl` call.
- Old deployment URLs were not enumerated; whether any is still served/cached is UNKNOWN.

## upload-document re-check (C4, read-only)

Deployed v2 source equals repo `supabase/functions/upload-document/index.ts` except whitespace
(newline vs space, trailing newline; live sha256 `58454e9c…cb46`, repo `030a7e52…2d39`).
Order: OPTIONS/405/Bearer -> env -> `auth.getUser` -> form parse -> size (<= 20 MiB) -> MIME allow-list
-> magic bytes == MIME -> extension allow-list -> folder ownership (`user_id` filter) ->
path `${user.id}/<ts>-<uuid>-<safeName>` -> service-role `upload` (upsert false) -> `documents` insert
(FK to auth.users + trigger `enforce_document_account_isolation`) -> on insert error `remove([path])`.
Finding: the `remove` result/exception is not checked and the insert cause is not logged
(separate PR for upload-document). Uses `supabase-js@2` (unpinned).

## Tests

`src/lib/security/storage-no-direct-client-write.test.ts` (C2): TypeScript-AST scan of all non-test
files under `src/` for Storage write calls (`upload`, `update`, `uploadToSignedUrl`,
`createSignedUploadUrl`, `move`, `copy`) including multi-line chains, const/let aliases,
destructured `storage`, element access; positive fixtures (invoke upload-document,
createSignedUrl, remove, Postgrest update) and negative fixtures. Verified that it flags the
pre-a8d5023 `documents.ts`. Plus SQL checks: forward only drops the two policies; rollback equals 192515. Static checks only; they do not prove the live state.
