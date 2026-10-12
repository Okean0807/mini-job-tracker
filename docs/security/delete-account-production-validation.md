# delete-account — Production validation (PR #133)

Project `jauzsejxdfpnlgdtohuv`, commit `f65e5c8076e02ef660fe101d74da9f78d639b76e`.
No secrets, tokens or personal data in this file.

## Deployed state (re-read 2026-10-12)

| Function        | Version | verify_jwt | ezbr_sha256     | Updated (CEST)      |
| --------------- | ------- | ---------- | --------------- | ------------------- |
| delete-account  | 2       | true       | `a29cfe59…5617` | 2026-10-12 14:19:51 |
| upload-document | 2       | true       | `557a59c7…9133` | 2026-09-30 21:24:37 |

Deployed sources equal `f65e5c8`: `index.ts` sha256 `3166a3fe…f5c9`, `handler.ts` sha256 `1555831d…2a26`.

## HTTP probes (2026-10-12, no data change)

OPTIONS 200 + CORS (handler) · POST without Authorization 401 (gateway, `UNAUTHORIZED_NO_AUTH_HEADER`) ·
GET with anon key 405 `method-not-allowed` (handler, before admin client).

## Integration test (Round 4, one throwaway Dashboard-created user, 2026-10-12 CEST)

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
- Access JWT remains valid after deletion until `exp` (late-upload window, see
  `late-upload-after-account-deletion.md`, separate PR).

## 22-point audit (handler.ts = `supabase/functions/delete-account/handler.ts`)

| #   | Requirement                                                 | Code                                                                                                                                                                                                                     | Test                   | Result                              |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------- |
| 1   | OPTIONS before admin client                                 | handler.ts:194                                                                                                                                                                                                           | 17 + live probe        | PASS                                |
| 2   | non-POST 405 before admin client                            | handler.ts:195                                                                                                                                                                                                           | 17, live GET 405       | PASS                                |
| 3   | missing/blank/non-Bearer -> 401 before admin client         | handler.ts:197-200                                                                                                                                                                                                       | A3                     | PASS (mock)                         |
| 4   | missing env -> 500 server-not-configured                    | handler.ts:202-204                                                                                                                                                                                                       | 17                     | PASS (mock)                         |
| 5   | identity via getUser(token); error or null -> 401           | handler.ts:207-211                                                                                                                                                                                                       | 13, A2, R14            | PASS                                |
| 6   | uid segment validated                                       | handler.ts:83-87,102                                                                                                                                                                                                     | 14b                    | PASS (mock)                         |
| 7   | every listed path inside `<uid>/`                           | handler.ts:125-127                                                                                                                                                                                                       | 14, A1, R16            | PASS (mock)                         |
| 8   | remove guard `<uid>/`, no `..`                              | handler.ts:145-150                                                                                                                                                                                                       | 14b                    | PASS (mock)                         |
| 9   | folders by `id === null`                                    | handler.ts:128                                                                                                                                                                                                           | 4                      | PASS (mock + live depth 2)          |
| 10  | recursive BFS, sequential                                   | handler.ts:107-134                                                                                                                                                                                                       | 3,4,5,R3               | PASS (live depth 2)                 |
| 11  | limit/offset, offset += raw page length, stop on short page | handler.ts:115-133                                                                                                                                                                                                       | 6,7,R1,R2,R4           | PASS (mock)                         |
| 12  | null page tolerated                                         | handler.ts:123                                                                                                                                                                                                           | R5a                    | PASS (mock)                         |
| 13  | depth limit 32 fail-closed                                  | handler.ts:39,113                                                                                                                                                                                                        | 14c,R7,R7b             | PASS (mock)                         |
| 14  | visited set (duplicates/cycles)                             | handler.ts:106,111                                                                                                                                                                                                       | 14c,R6                 | PASS (mock)                         |
| 15  | remove batches <= 1000                                      | handler.ts:38,151-152                                                                                                                                                                                                    | 7,8,R2                 | PASS (mock)                         |
| 16  | list/remove errors abort before DB/Auth                     | handler.ts:122,153,213-218                                                                                                                                                                                               | 9,10,R8,R9             | PASS (mock)                         |
| 17  | verification re-list after remove                           | handler.ts:164-166                                                                                                                                                                                                       | 11b,R10                | PASS (mock; runs only if paths > 0) |
| 18  | DB deletes documents -> folders -> backups, stop on error   | handler.ts:220-223                                                                                                                                                                                                       | 15,16,R12              | PASS (mock + live)                  |
| 19  | final re-list before deleteUser                             | handler.ts:230-236                                                                                                                                                                                                       | C,C2,R11               | PASS (mock)                         |
| 20  | deleteUser last; error -> 500                               | handler.ts:238-239                                                                                                                                                                                                       | 16,R13,R17             | PASS (mock + live)                  |
| 21  | outer catch: generic 500 + CORS, no internals               | handler.ts:186-190                                                                                                                                                                                                       | B,B2,R18               | PASS (mock)                         |
| 22  | runtime binding / client contract                           | index.ts:2,8-16 (supabase-js 2.112.3, no session persistence); account-delete.ts:9-12 (getUser, invoke POST, no body), :13 (error -> ok:false, no local wipe), :15-22 (local cleanup + local signOut only after success) | account-delete.test.ts | PASS                                |

verify_jwt=true is a deployment setting (verified live), not code.
