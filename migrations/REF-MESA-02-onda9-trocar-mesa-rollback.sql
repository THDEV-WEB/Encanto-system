-- ============================================================================
-- REF-MESA-02 · Onda 9 (troca de mesa) — ROLLBACK
-- Aditiva pura -- nenhuma funcao existente foi alterada, so remove a RPC nova.
-- Nao reverte nenhuma linha de dado (mesa_session_mesas/mesa_sessions) --
-- trocas ja realizadas ficam como historico permanente, mesmo padrao de
-- qualquer outro rollback deste dominio (nunca apaga dado real).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_trocar_mesa_sessao(uuid, text, uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
