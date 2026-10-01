# P1 — Document upload hardening

## Boundary

Document uploads are now validated in the Edge Function `upload-document`, not only by the browser.

Checks:
- authenticated user is derived from the bearer token;
- maximum size is 20 MiB;
- MIME type must be PDF, JPEG, PNG or WebP;
- extension must match an allowed document extension;
- magic bytes are checked against the declared MIME type;
- optional folder must belong to the authenticated user;
- storage path is generated server-side under `<user-id>/`;
- the database row is inserted only after storage upload succeeds;
- failed database insertion removes the uploaded object.

The storage bucket migration additionally enforces private access, the 20 MiB limit and the same MIME allow-list at the Supabase Storage layer.
