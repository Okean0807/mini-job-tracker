-- PENDING (NOT applied). Closes the post-deletion late-upload window for DIRECT
-- client Storage writes: a user's access JWT stays valid until expiry after
-- auth.admin.deleteUser, and the INSERT/UPDATE policies only check auth.uid()
-- from the JWT, so such a client could still write <uid>/... objects that no
-- account owns any more.
--
-- The app never writes to the bucket directly: all uploads go through the
-- upload-document Edge Function (service role, re-validates the user with
-- auth.getUser and rolls the object back if the documents insert fails, e.g. on
-- the auth.users FK after deletion). Client code only uses createSignedUrl
-- (SELECT) and remove (DELETE), which stay allowed.
--
-- Rollback: re-create both policies exactly as in
-- 20260930192403_p1_storage_policy_drift_hardening.sql.
drop policy if exists "Users upload own document files" on storage.objects;
drop policy if exists "Users update own document files" on storage.objects;
