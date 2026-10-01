# Legal / Privacy Release Checklist

This checklist records what the current source code supports and what still requires operator/legal input before a public release.

## Technically evidenced by the application

- The app can store work shifts, hours, rates, earnings, jobs, payments, absences and related metadata locally.
- Optional cloud functionality uses the configured Supabase backend.
- User documents can be stored in the private `documents` storage bucket.
- The document upload Edge Function authenticates the bearer token, validates file type/content/size, scopes the storage path to the authenticated user and removes an uploaded object if the database insert fails.
- Account deletion has a server-side Edge Function which authenticates the user and deletes the user's document objects, application rows and auth user.
- The AI assistant can receive app context containing work/earnings information when that context is selected for an AI request.
- The current AI implementation uses Gemini as the LLM provider and Tavily for current-information web search. API keys are resolved server-side; they are not intended to be exposed through Vite client environment variables.
- AI request rate limiting is enforced through the database RPC and is designed to fail closed when the security check cannot be evaluated.

## Must be completed before public release

- Replace the placeholder Impressum with the real provider identity and legally required provider information.
- Complete the privacy notice with the actual controller, purposes, legal bases, recipients/processors, international-transfer information, retention periods and data-subject rights applicable to the deployed configuration.
- Confirm the contractual/privacy status of the configured Gemini and Tavily services for the intended deployment and document the applicable processors/sub-processors and transfer mechanisms.
- Decide and document whether AI requests are optional and how users can avoid sending work/earnings context to the AI service.
- Verify production Supabase settings, including leaked-password protection and relevant Auth security settings.
- Verify production RLS/storage policies and account deletion with a real test account.
- Rotate any historical secret that was previously exposed and verify repository secret-scanning status.

## Important distinction

The routes `/impressum`, `/datenschutz` and `/ki-hinweise` are intentionally not presented as a completed legal review. Source code cannot determine the operator's legal identity, contractual arrangements, retention policy or final legal basis by itself.
