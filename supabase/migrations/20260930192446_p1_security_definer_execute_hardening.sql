
REVOKE ALL ON FUNCTION public.enforce_document_account_isolation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_ai_rate_limit(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_rate_limit(uuid, bigint) TO authenticated;

