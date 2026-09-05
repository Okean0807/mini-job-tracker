# MiniJob Companion — Security Status

Last updated: 2026-09-05 (Europe/Berlin)

This document records **verified** facts only. Items not actually performed are marked **BLOCKED** or **NOT DONE**.

## Tip (current `main`)

| Check | Result |
|-------|--------|
| Tip SHA (at write time) | `53df4b0` (Merge PR #20) |
| Committed `.env` on tip | **PASS** — absent |
| Real `sb_publishable_*` / service-role values in tip tree | **PASS** — none found (only prefix validators + empty `.env.example` placeholders) |
| Tree paths matching `.env` | only `.env.example` |

## History (publishable-key exposure)

| Event | Commit | Date (UTC) |
|-------|--------|------------|
| `.env` introduced | `30be62c` | 2026-08-12 |
| `.env` removed (forward-fix, no rewrite) | `639ce65` | 2026-09-04 |

- Historical blob still reachable via GitHub Contents/Git API (blob size 361).
- Lovable sync forbids history rewrite / force-push → **old secrets remain in git history**.
- **Mitigation that actually closes risk:** rotate the exposed Supabase publishable key (and any other values that were in that `.env`) in the Supabase / Lovable dashboard, then invalidate the old key.

## Key rotation

| Action | Status |
|--------|--------|
| Autonomous rotation via GitHub PAT / `gh` | **BLOCKED** — not possible with repo scopes alone |
| Rotation in Supabase / Lovable UI | **NOT DONE** — requires Juri (human) |
| Claimed as rotated | **NO** |

### Rotation checklist (for Juri)

1. Open Supabase project for MiniJob Companion (or Lovable secrets UI).
2. Rotate **publishable** (anon) key; update local `.env` / Lovable env; redeploy if needed.
3. If `SERVICE_ROLE` or `LOVABLE_API_KEY` were ever in the leaked `.env`, rotate those too.
4. Confirm app login + cloud sync still work with the new key.
5. Tell Stabschef the date/time of rotation (do **not** paste the new key into chat).

## GitHub Secret Scanning

| Action | Status |
|--------|--------|
| Alerts API | **disabled** (`404` — Secret scanning is disabled) |
| Attempt to enable via REST `PATCH` repo `security_and_analysis` | **FAILED** — `422` *Secret scanning is not available for this repository* |
| Enabled by us | **NO** |

Private repos typically need GitHub Advanced Security (or org policy) for secret scanning. Enabling is **BLOCKED** on current plan/API availability until GitHub settings allow it.

## What is NOT claimed

- We do **not** claim key rotation completed.
- We do **not** claim secret scanning is on.
- We do **not** claim history is purged of secrets.

## Residual risk

1. Anyone with repo read access can still recover historical `.env` content from git.
2. Until keys are rotated, treat those historical values as compromised.
3. Manual cloud smoke (login/sync/restore/conflict) remains a separate P1 track after rotation / with current keys only if Juri accepts residual risk.

## Next automated steps after human rotation

1. Re-verify tip still has no secrets.
2. Re-run independent QA security audit → expect tip hygiene **PASS**, overall security still **NEEDS_REVIEW** until scanning and/or rotation confirmed.
3. Proceed P1 cloud smoke with real credentials (mark **BLOCKED** if physical login required).
