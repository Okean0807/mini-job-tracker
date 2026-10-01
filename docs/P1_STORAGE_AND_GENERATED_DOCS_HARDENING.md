# P1 — Storage infrastructure and generated-document hardening

## Storage boundary

The `documents` bucket is private, limited to 20 MiB per object, and restricted to PDF/JPEG/PNG/WebP. The migration chain now explicitly recreates the bucket configuration and the four ownership policies so a fresh Supabase project receives the same boundary as the current application.

The upload Edge Function remains the server-side validation boundary: it authenticates the caller, validates size/MIME/extension/magic bytes, generates the user-scoped storage path, validates folder ownership, and rolls back the object if the database row cannot be created.

## Generated exports

Generated PDF/XLSX/Arbeitsnachweis files are intentionally device-local exports; they are not silently uploaded to cloud storage. Their registry is scoped to the active account/device namespace.

A registry entry now explicitly distinguishes:

- `local` — the payload is still available in localStorage and can be opened/downloaded again;
- `downloaded_only` — the export was downloaded successfully, but its binary payload is no longer retained locally.

When localStorage quota is reached, the registry no longer strips payloads from every document in one fallback operation. It progressively evicts payloads from older entries first and preserves the newest reopenable exports for as long as the quota allows.

The Documents hub labels downloaded-only entries so the user is not misled into thinking the app can reopen the file.

## Deliberate scope

No automatic cloud upload of generated exports was added in this hardening phase. Such a feature would change the privacy/data-retention model and should be designed separately.
