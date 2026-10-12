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

## Rollback

Re-create the two policies verbatim from
`supabase/migrations/20260930192403_p1_storage_policy_drift_hardening.sql`.

## Tests

`src/lib/security/storage-no-direct-client-write.test.ts`: pending SQL only drops
the two policies; app code contains no direct Storage write. Content checks only;
they do not prove the live state.
