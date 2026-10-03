# P1 — AI Security & Privacy Hardening

- AI conversation history is bounded to 50 conversations and 100 messages per conversation.
- Individual stored messages are capped at 8,000 characters.
- History normalization is applied on load and save, limiting localStorage growth.
- The AI context now contains three calendar years (current + two previous) so period-specific questions are not limited to the current year.
- The server-side AI rate limit is shared through Supabase/PostgreSQL rather than an in-memory map per serverless instance.
- The rate-limit RPC derives authorization from `auth.uid()` and rejects a user ID that does not match the authenticated token.
- The AI endpoint fails closed if the shared rate-limit control cannot be evaluated.

## Boundary limitation

The application is local-first: the client currently supplies the calculated AI context to the server function. The server authenticates the caller, but it cannot independently reconstruct local-only employment data. Therefore the server cannot cryptographically prove that an arbitrary context string originated from that user's local store. A future server-authoritative data model would be required for that stronger guarantee.
