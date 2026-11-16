# AI feature flag (`AI_FEATURES_ENABLED`)

Single, server-side master switch for every external AI call (Gemini and Tavily).

| Value | Effect |
|---|---|
| exactly `true` | AI available (previous behaviour) |
| unset / empty / anything else | AI off — **default for the free launch** |

## What "off" guarantees
- `askAssistant` (`src/lib/ai.functions.ts`) throws `AiGuardError("unavailable")` before the
  rate-limit RPC and before a provider is created.
- `createDefaultProvider()` (`src/lib/ai/provider.ts`) throws too, so no Gemini/Tavily object exists.
- The only `fetch` calls to `generativelanguage.googleapis.com` / `api.tavily.com` live in the two
  provider files and are reachable only through that chain (guarded by tests).
- The UI asks the server (`getAiStatus`, returns `{ enabled: boolean }` only). While loading, on error
  or for any non-`true` answer the AI is treated as unavailable: no nav entry, `/assistent` shows a
  notice, no chat input, no `AiNoticeDialog`, no history read, no context built.
- Local chat history in `localStorage` is untouched. API keys, provider code, migrations and
  `ai_rate_limits` are unchanged.

## Re-enabling (only after the separate legal review)
1. Legal/owner: DPAs and transfer mechanisms for Google (Gemini) and Tavily, updated
   Datenschutzerklärung / Impressum / KI-Hinweise.
2. Make sure `GEMINI_API_KEY` (and optionally `TAVILY_API_KEY`) are set in the platform secrets.
3. Set `AI_FEATURES_ENABLED=true` on **Preview** first, redeploy, test chat, sources and rate limit.
4. If the notice text changed, bump `AI_NOTICE_KEY_BASE` in `src/lib/minijob/ai-notice.ts`.
   Also restore the texts that were reduced for the free launch: the AI wording in `premium.settingsDesc`
   (`src/lib/i18n/dict/entry.ts`, all five languages), the static `head` description of `/assistent`
   (`src/routes/assistent.tsx`) and, after the legal review, `/datenschutz` and `/ki-hinweise`. The test
   `src/lib/ai-disclosure-consistency.test.ts` guards the "AI off" wording and must be updated with them.
5. Set it on Production and redeploy. Rollback = remove the variable and redeploy.
