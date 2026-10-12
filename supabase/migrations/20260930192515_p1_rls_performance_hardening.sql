
CREATE INDEX IF NOT EXISTS document_folders_user_idx
  ON public.document_folders (user_id, created_at DESC);

DROP POLICY IF EXISTS "Users manage own backup" ON public.backups;
CREATE POLICY "Users manage own backup" ON public.backups
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own documents" ON public.documents;
CREATE POLICY "Users manage own documents" ON public.documents
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own folders" ON public.document_folders;
CREATE POLICY "Users manage own folders" ON public.document_folders
  FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users read own document files" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own document files" ON storage.objects;
DROP POLICY IF EXISTS "Users update own document files" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own document files" ON storage.objects;

CREATE POLICY "Users read own document files"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own document files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users update own document files"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own document files"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documents' AND (select auth.uid())::text = (storage.foldername(name))[1]);

