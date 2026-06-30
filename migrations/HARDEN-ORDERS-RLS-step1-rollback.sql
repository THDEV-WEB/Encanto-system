-- Rollback do Step 1 (HARDEN-ORDERS-RLS). Volta create_order a SECURITY INVOKER. ATÔMICO.
-- ⚠️ Reverter create_order para INVOKER RE-QUEBRA o checkout anon se as policies 'Allow all' já tiverem sido
--    removidas (step2). Ordem correta de reversão do bloco: step2-rollback ANTES deste step1-rollback.
BEGIN;

ALTER FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) SECURITY INVOKER;
ALTER FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) RESET search_path;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb, uuid) TO PUBLIC;

COMMIT;
