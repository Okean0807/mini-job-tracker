# P1 — Async Account-Switch Hardening

## Scope

This phase verifies that asynchronous cloud operations cannot write data or sync metadata into the wrong account namespace during rapid account transitions.

## Required invariant

```text
A session
  ↓ async operation
logout
  ↓
B session
  ↓
logout
  ↓
A session again

late result from the first operation → MUST be discarded
```

## Existing protection

`cloud.ts` already uses two independent guards:

- `scopeEpoch` invalidates operations after namespace changes;
- `syncEpoch` invalidates an individual sync run after timeout/cancellation;
- `snapshotOwner()` captures account, namespace owner and metadata key;
- `stillOwner()` verifies those values after every relevant `await`.

## Added regression coverage

The account-isolation suite now explicitly covers:

1. A → B → A while a restore for the first A session is waiting;
2. debounced work surviving a rapid A → B → A transition;
3. no B backup writes;
4. no stale restore into the second A session;
5. no false `error` state caused by a stale operation.

## Result

The current cloud-sync architecture has explicit epoch-based protection against stale async results across account changes. Full runtime execution still requires the project's Bun/Node dependencies and CI environment.
