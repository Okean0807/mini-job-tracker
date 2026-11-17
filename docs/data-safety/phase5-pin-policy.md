# Phase 5 – device PIN policy (decision document)

## Existing behaviour (verified in code and tests)

* **Upload:** `payloadOf()` → `stripDeviceAuthForCloud()` removes `pin` and `biometricCredentialId` and
  forces `pinEnabled=false`, `biometric=false`. Verified end to end by
  `cloud.guarded-operations.test.ts` ("PIN und Biometrie-ID verlassen das Gerät nie").
* **JSON import / snapshot restore (Phase 4):** device authentication of the file is stripped first, the
  local one is kept – even when the device has none (`guarded-local.ts`; tests in
  `data-safety.characterization.import.test.ts`).
* **Cloud restore (`applyRemote` → `mergeDeviceAuthFromLocal`):**
  1. local PIN present → kept; the cloud PIN is ignored;
  2. local WebAuthn id → kept; a cloud WebAuthn id is never adopted;
  3. **local has no valid PIN and the cloud payload still holds a valid `pin` → that PIN is adopted**
     (the "one-time legacy migration" clause).
  Callers: guarded cloud restore, conflict "keep cloud", automatic first restore (empty device) and the
  automatic pull (unchanged local state).

## Why clause 3 exists and what it can do

Older app versions uploaded the PIN in plaintext inside `backups.payload`. Clause 3 lets a user who
signs in on a second device keep the lock they had. Only a row that has **not been written by any
current client since the stripping change** can still contain a PIN – every Phase 4 upload replaces the
whole payload.

Security implications:
* It does not leak anything new (the plaintext PIN is already in the row); it *establishes a lock on
  the device from cloud data*, which contradicts "device authentication stays device-local".
* Via the **automatic** paths it happens without any prompt.
* A user can be locked out of a new device by a PIN they no longer remember (availability, not
  confidentiality).
* A writer who can write the user's own row (legacy client, API caller) can plant a PIN that a fresh
  device will adopt (denial of access on that device; the same writer could equally overwrite the data).

## Can it be removed without breaking existing users?

**Not established.** It depends on how many cloud rows still contain `settings.pin`. That requires
reading production data, which Phase 5 is forbidden to do, and the test project was not approved for
use. Removing the clause blindly would silently drop the lock for exactly those users on their next
new-device restore (a visible downgrade they did not choose), so **the authentication contract was not
changed.**

The owner can measure it without exposing any PIN (count only, run in the SQL editor):

```sql
select count(*) as rows_with_legacy_pin
from public.backups
where payload -> 'settings' ? 'pin' and nullif(payload -> 'settings' ->> 'pin', '') is not null;
```

## Options

| | Option | Compatibility | Risk |
|---|---|---|---|
| A | Keep clause 3 (status quo) | full | silent lock establishment on automatic paths |
| B | Remove clause 3 | users with a legacy PIN in the cloud lose the lock on a new device | none for confidentiality; UX downgrade |
| C | Keep clause 3 **only in the guarded, confirmed restore**, never in automatic paths | full for deliberate restores | automatic first-restore on a fresh device would no longer carry the PIN (user sets it again) |
| D | One-off cleanup of legacy PINs in the cloud (separate, approved production write) followed by B | none lost if the count is 0 | needs approval; do after measuring |

**Recommendation:** measure first. If the count is 0 or negligible → B (and optionally D). Otherwise C.

## Implemented in Phase 5 (does not change the contract)

* The guarded restore preview now carries `deviceAuth: "kept" | "adopted"`. When clause 3 would apply,
  the confirmation dialog shows a warning ("this old backup still contains a PIN … would be set here")
  instead of the previous, then inaccurate, "PIN … stay unchanged" line.
* Tests pin the behaviour in all three cases (local PIN kept / no PIN anywhere / legacy PIN adopted
  with warning) so any later change is deliberate.
