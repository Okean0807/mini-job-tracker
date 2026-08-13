CREATE TABLE public.document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#0d9488',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_folders TO authenticated;
GRANT ALL ON public.document_folders TO service_role;

ALTER TABLE public.document_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own folders" ON public.document_folders
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_document_folders_updated_at
BEFORE UPDATE ON public.document_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.documents
  ADD COLUMN folder_id uuid REFERENCES public.document_folders(id) ON DELETE SET NULL,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX documents_folder_id_idx ON public.documents(folder_id);
CREATE INDEX documents_tags_idx ON public.documents USING gin(tags);