-- ============================================================================
-- REF-MESA-02 · Onda 10 (juncao de mesas) — ROLLBACK
-- Aditiva pura -- nenhuma funcao existente foi alterada, so remove a RPC nova.
-- Nao reverte nenhuma linha de dado -- juncoes ja realizadas ficam como
-- historico permanente, mesmo padrao de qualquer outro rollback deste
-- dominio (nunca apaga dado real).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_juntar_mesa_sessao(uuid, text, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
