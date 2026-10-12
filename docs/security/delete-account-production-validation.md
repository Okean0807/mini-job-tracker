# delete-account — Production validation (PR #133)

Project `jauzsejxdfpnlgdtohuv`, commit `f65e5c8076e02ef660fe101d74da9f78d639b76e`.
No secrets, tokens or personal data in this file.

## Deployed state (re-read 2026-10-12)

| Function        | Version | verify_jwt | ezbr_sha256     | Updated (CEST)      |
| --------------- | ------- | ---------- | --------------- | ------------------- |
| delete-account  | 2       | true       | `a29cfe59…5617` | 2026-10-12 14:19:51 |
| upload-document | 2       | true       | `557a59c7…9133` | 2026-09-30 21:24:37 |

Deployed sources equal `f65e5c8`: `index.ts` sha256 `3166a3fe…f5c9`, `handler.ts` sha256 `1555831d…2a26`.

## HTTP probes — live-HTTP (2026-10-12 14:25 CEST, no data change)

OPTIONS 200 + CORS (handler) · POST without Authorization 401 (gateway, `UNAUTHORIZED_NO_AUTH_HEADER`) ·
GET with anon key 405 `method-not-allowed` (handler, before admin client).

## Integration test — live-R4 (Round 4, one throwaway Dashboard-created user, 2026-10-12 CEST)

| Time        | Step                                                                                       | Result                                                                |
| ----------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 16:18:46    | password sign-in (1 attempt)                                                               | 200, JWT sub = test uid                                               |
| 16:18:47–48 | upload `<uid>/root.pdf`, `<uid>/a/x.png`, `<uid>/a/b/y.pdf` (direct Storage API, user JWT) | 200 ×3                                                                |
| 16:18:49–50 | insert document_folders / documents / backups (PostgREST, RLS)                             | 201 ×3                                                                |
| 16:22:22    | POST delete-account (user JWT)                                                             | 200 `{"ok":true}`                                                     |
| 16:22:30    | repeat POST, same JWT                                                                      | 401 `{"error":"not-signed-in"}` (handler; gateway still accepted JWT) |

Post-checks (SQL, test uid): auth.users 0, auth.identities 0, objects 0, documents 0, document_folders 0, backups 0, ai_rate_limits 0.

### Global counts (include ALL users, not only the test user)

|                             | Before seed  | After delete |
| --------------------------- | ------------ | ------------ |
| auth.users                  | 4 (3 + test) | 3            |
| documents                   | 1            | 1            |
| document_folders            | 0            | 0            |
| backups                     | 3            | 3            |
| ai_rate_limits              | 1            | 1            |
| storage objects (documents) | 1            | 1            |

### Limitations

- Real Storage verified only for depth 2 and 3 files; pagination > 1000, batch failures and the
  late-object path are verified with fake clients only (`delete-account-function.test.ts`,
  `delete-account-resilience.test.ts`).
- Test user had no ai_rate_limits row; CASCADE not exercised live.
- Repeat 401 is not a proof of idempotency.
- Access JWT remains valid after deletion until `exp` (late-upload window). Design note and pending fix are in PR #135
  (`docs/security/late-upload-after-account-deletion.md` exists only on that branch until it is merged).

## 22-point audit

Line references are pinned to commit `f65e5c8076e02ef660fe101d74da9f78d639b76e`
(`git show f65e5c8:<path> | nl -ba`). `handler.ts` = `supabase/functions/delete-account/handler.ts`,
`index.ts` = `supabase/functions/delete-account/index.ts`, `account-delete.ts` = `src/lib/minijob/account-delete.ts`.
Test IDs: plain numbers / letters = `src/lib/security/delete-account-function.test.ts`,
`R*` = `src/lib/security/delete-account-resilience.test.ts`.

Evidence: **live-HTTP** = 2026-10-12 HTTP probes (no data); **live-R4** = Round 4 integration test
(one throwaway user, 3 objects, depth 2, 3 rows); **mock** = fake clients only.

| #   | Requirement                                                               | Code (symbol, f65e5c8 line)                                                                                                                                                                                                     | Tests                  | Evidence                                                     | Result |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ | ------ |
| 1   | OPTIONS answered before admin client                                      | `handleDeleteAccountUnsafe` handler.ts:178                                                                                                                                                                                      | 17                     | mock + live-HTTP (200, CORS)                                 | PASS   |
| 2   | non-POST -> 405 before admin client                                       | handler.ts:179                                                                                                                                                                                                                  | 17                     | mock + live-HTTP (GET 405)                                   | PASS   |
| 3   | missing/blank/non-Bearer -> 401 before admin client                       | handler.ts:181-184                                                                                                                                                                                                              | A3                     | mock (live no-auth 401 came from the gateway, not this code) | PASS   |
| 4   | missing env -> 500 server-not-configured                                  | handler.ts:186-188                                                                                                                                                                                                              | 17                     | mock                                                         | PASS   |
| 5   | identity via `auth.getUser(token)`; error or null -> 401                  | handler.ts:190-195                                                                                                                                                                                                              | 13, A2, R14            | mock + live-R4 (repeat POST 401 after deletion)              | PASS   |
| 6   | uid segment validated                                                     | `assertSafeSegment` handler.ts:67-71, 86                                                                                                                                                                                        | 14b                    | mock                                                         | PASS   |
| 7   | every listed path inside `<uid>/`                                         | `listAllUserObjectPaths` handler.ts:109-111                                                                                                                                                                                     | 14, A1, R16            | mock                                                         | PASS   |
| 8   | remove guard `<uid>/`, no `..`                                            | `removeInBatches` handler.ts:131                                                                                                                                                                                                | 14b                    | mock                                                         | PASS   |
| 9   | folders detected by `id === null`                                         | handler.ts:112                                                                                                                                                                                                                  | 4                      | mock + live-R4 (depth 2)                                     | PASS   |
| 10  | recursive BFS, sequential                                                 | handler.ts:91-118                                                                                                                                                                                                               | 3, 4, 5, R3            | mock + live-R4 (depth 2)                                     | PASS   |
| 11  | limit/offset; offset += raw page length; stop on short page               | handler.ts:99-116                                                                                                                                                                                                               | 6, 7, R1, R2, R4       | mock                                                         | PASS   |
| 12  | null page tolerated                                                       | handler.ts:107                                                                                                                                                                                                                  | R5a                    | mock                                                         | PASS   |
| 13  | depth limit 32, fail-closed                                               | `MAX_FOLDER_DEPTH` handler.ts:23, 97                                                                                                                                                                                            | 14c, R7, R7b           | mock                                                         | PASS   |
| 14  | visited set (duplicates/cycles)                                           | handler.ts:90, 95-96                                                                                                                                                                                                            | 14c, R6                | mock                                                         | PASS   |
| 15  | remove batches <= 1000                                                    | `REMOVE_BATCH_SIZE` handler.ts:22, 135-136                                                                                                                                                                                      | 7, 8, R2               | mock (live-R4: 3 objects, 1 batch)                           | PASS   |
| 16  | list/remove errors abort before DB/Auth                                   | handler.ts:106, 137, 197-202                                                                                                                                                                                                    | 9, 10, R8, R9          | mock                                                         | PASS   |
| 17  | verification re-list after remove (only if paths > 0)                     | `cleanupUserStorage` handler.ts:148-150                                                                                                                                                                                         | 11b, R10               | mock                                                         | PASS   |
| 18  | DB deletes documents -> document_folders -> backups, stop on error        | handler.ts:204-207                                                                                                                                                                                                              | 15, 16, R12            | mock + live-R4 (0 rows after)                                | PASS   |
| 19  | final re-list before deleteUser                                           | handler.ts:214-220                                                                                                                                                                                                              | C, C2, R11             | mock                                                         | PASS   |
| 20  | deleteUser last; error -> 500                                             | handler.ts:222-223                                                                                                                                                                                                              | 16, R13, R17           | mock + live-R4 (auth user gone)                              | PASS   |
| 21  | outer catch: generic 500 `internal-error` + CORS, thrown value not echoed | `handleDeleteAccount` handler.ts:170-174                                                                                                                                                                                        | B, B2 (function test)  | mock                                                         | PASS   |
| 22  | runtime binding and client contract                                       | index.ts:2, 8-16; account-delete.ts:8-10 (getUser), account-delete.ts:12 (invoke POST, no body), account-delete.ts:13 (error -> ok:false, no local wipe), account-delete.ts:15-22 (local cleanup + local signOut after success) | account-delete.test.ts | mock + live-R4 (POST 200)                                    | PASS   |

`verify_jwt=true` is a deployment setting (verified live via `list_edge_functions`), not code.

Note on R18 (`delete-account-resilience.test.ts`): it checks that the failure responses of three
handled paths (DB error, deleteUser error, missing user) are a bare `{ "error": "<code>" }` JSON with
CORS. It does **not** exercise the outer `catch` (row 21) and does not prove that thrown internals are
never echoed; that is covered by `delete-account-function.test.ts` B and B2 only.
