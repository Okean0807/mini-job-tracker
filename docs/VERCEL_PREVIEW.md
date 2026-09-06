# Vercel Preview (in-repo prep)

**Status:** Gate A in repo — **no** Vercel project connect, deploy, or domain yet.  
**SoT:** GitHub `main` on `Okean0807/mini-job-tracker`. Lovable preview stays diagnostic only.

## What this repo sets

`vite.config.ts` passes `nitro: { preset: "vercel" }` into `@lovable.dev/vite-tanstack-config`.

| Build environment | Effective Nitro target |
|-------------------|------------------------|
| Outside Lovable sandbox (local CI, Vercel) | **`vercel`** (explicit preset) |
| Inside Lovable sandbox | Still **`cloudflare-module`** (sandbox override; expected) |

Do **not** add a second Nitro/Vite plugin by hand — the Lovable config already wires Nitro on `vite build`.

## Env (build-time, Preview + Production)

Required:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Recommended for SSR / server helpers:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY` (or publishable anon equivalent)
- Server-only (never `VITE_`): `SUPABASE_SERVICE_ROLE_KEY` only if `client.server.ts` paths are used

## Owner steps still blocked (bots cannot)

1. Authorize Vercel ↔ GitHub for the repo (Owner OAuth).
2. Create/import the Vercel project from this GitHub repo.
3. Set the env vars above for Preview (and later Production).
4. Confirm first Preview URL boots; Production cutover needs explicit GO.

## TanStack pins (do not bump with GATE6)

- `@tanstack/react-router` `1.170.18`
- `@tanstack/router-plugin` `1.168.23`
- `@tanstack/react-start` `1.168.32`

## Out of scope here

Connect, deploy, custom domain, Lovable disconnect, key rotation, MegaEmu.

## Commit author (Hobby / Vercel Collaboration)

Vercel Hobby projects only build commits whose **Git author email** maps to the
GitHub account that owns the Vercel project (`Okean0807`).

Use for bot/agent commits (env, not `git config --global`):

- `GIT_AUTHOR_NAME=Okean0807`
- `GIT_AUTHOR_EMAIL=jurivollmer@gmail.com`
- same for `GIT_COMMITTER_*`

Do **not** use `stabschef+…@users.noreply.github.com` — those commits stay
unattributed on GitHub and Vercel blocks the deployment.

