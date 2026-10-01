# MiniJob Kompagnon — P1 Cloud Sync Hardening

Date: 2026-09-30

## Scope

This phase hardens the authenticated cloud-sync boundary after the P0 legal/security work.

## Fixed

- A timed-out sync run is invalidated through the existing sync epoch.
- A late `push()` completion is no longer allowed to write `lastSyncedAt`, clear pending-change markers, or call `markBackup()` after its epoch has been abandoned.
- The guard applies to both manual `backupNow()` and automatic sync.
- Account/scope ownership checks remain mandatory before and after cloud I/O.
- Regression coverage now explicitly exercises a delayed upload completing after the timeout.

## Important limitation

A timeout cannot retroactively cancel a network request that has already reached Supabase. The hardening guarantees that a late completion cannot mutate the local sync state as if the timed-out operation had succeeded. Server-side write cancellation is not asserted here.

## Still requiring real-environment verification

- authenticated login/logout with the deployed Supabase project;
- cloud restore on a new device;
- local-vs-cloud conflict resolution with two authenticated sessions/devices;
- RLS behavior with an account that is not the backup owner;
- real production latency/offline transitions.

Those checks require valid runtime credentials and are not claimed as completed by this source snapshot.

## P1 account-isolation boundary (2026-09-30)

Cloud backup rows were already protected by `auth.uid() = user_id` RLS. This
phase additionally hardens document metadata at the database boundary:

- `documents.user_id` must match the authenticated user for normal client calls.
- `documents.path` must start with that same user UUID as its first path segment.
- `documents.folder_id`, when present, must reference a folder owned by the same user.
- service-role/background operations remain possible without a browser auth claim;
  normal authenticated access remains constrained by RLS.

This prevents a caller who knows another account's folder UUID or storage path
from creating a cross-account document reference through the metadata table.
