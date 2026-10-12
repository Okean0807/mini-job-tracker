-- ROLLBACK for supabase/pending/20261012160000_p2_documents_no_direct_client_write.sql
-- PENDING / NOT applied. Re-creates the two policies EXACTLY as defined by the last
-- applied definition, supabase/migrations/20260930192515_p1_rls_performance_hardening.sql
-- (lines 32-39), which uses `(select auth.uid())` (initPlan form). The older
-- 20260930192403 used bare `auth.uid()`; live pg_policies (read 2026-10-12) match 192515.
DROP POLICY IF EXISTS "Users upload own document files" ON storage.objects;
DROP POLICY IF EXISTS "Users update own document files" ON storage.objects;

CREATE POLICY "Users upload own document files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own document files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);
