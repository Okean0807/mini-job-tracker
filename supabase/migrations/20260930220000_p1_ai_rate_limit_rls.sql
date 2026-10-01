-- AI rate-limit state is server-owned and must never be directly readable/writable by clients.
-- consume_ai_rate_limit() is SECURITY DEFINER and is the sole intended access path.
alter table public.ai_rate_limits enable row level security;

-- Deliberately no client policies are created.
-- Existing table privileges remain revoked for anon/authenticated.
-- The SECURITY DEFINER function performs auth.uid() = p_user_id validation.
