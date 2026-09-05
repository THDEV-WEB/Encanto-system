-- ============================================================================
-- REF-MESA-02 · Onda 8 (consulta da conta) — ROLLBACK
-- Aditiva pura -- nenhuma funcao existente foi alterada, so remove a RPC nova.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_consultar_conta_mesa(text, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
