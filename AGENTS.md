<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Secrets / .env

Do not commit `.env`. Use `.env.example` as the template. Configure real
keys in Lovable / local env / platform secrets only. Prefer forward-fixes
over history rewrites (Lovable sync).

## Local development

GitHub Actions installs with Bun (`bun install --frozen-lockfile`) and runs
`bun run test`. `bun run dev` serves the app on port 8080.

Local demo mode (“Ohne Registrierung testen”) stores shifts in the browser.
Cloud sync and the assistant need the variables in `.env.example`.
`bun run build` skips the Supabase env check unless `VERCEL=1`.

`bun run lint` currently reports existing Prettier findings. CI runs the
test script only.
