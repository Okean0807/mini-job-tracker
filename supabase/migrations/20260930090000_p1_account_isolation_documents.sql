-- P1 account isolation hardening:
-- A document row must never reference another user's folder or another user's
-- storage namespace, even if a caller knows the UUID/path.
CREATE OR REPLACE FUNCTION public.enforce_document_account_isolation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  folder_owner uuid;
  path_owner text;
BEGIN
  -- service_role/background jobs may operate without auth.uid(); RLS still
  -- governs normal authenticated clients.
  IF auth.uid() IS NOT NULL AND NEW.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'document user_id does not match authenticated user';
  END IF;

  path_owner := split_part(NEW.path, '/', 1);
  IF path_owner IS NULL OR path_owner = '' OR path_owner <> NEW.user_id::text THEN
    RAISE EXCEPTION 'document path must belong to document user';
  END IF;

  IF NEW.folder_id IS NOT NULL THEN
    SELECT user_id INTO folder_owner
    FROM public.document_folders
    WHERE id = NEW.folder_id;

    IF folder_owner IS NULL OR folder_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'document folder does not belong to document user';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_document_account_isolation ON public.documents;
CREATE TRIGGER enforce_document_account_isolation
BEFORE INSERT OR UPDATE OF user_id, path, folder_id
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.enforce_document_account_isolation();
