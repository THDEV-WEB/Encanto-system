-- ============================================================================
-- REF-MESA-02 · Onda 2 — ROLLBACK
-- Greenfield: nenhuma RPC grava em mesa_sessions/mesa_session_mesas ainda,
-- nenhum dado real pode existir nelas -- DROP direto e seguro. CASCADE remove
-- os triggers automaticamente; as funcoes de trigger sao objetos separados e
-- precisam de DROP explicito.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.mesa_session_mesas CASCADE;
DROP TABLE IF EXISTS public.mesa_sessions CASCADE;

DROP FUNCTION IF EXISTS public._mesa_session_mesas_sync_status();
DROP FUNCTION IF EXISTS public._mesa_session_mesas_immutable();
DROP FUNCTION IF EXISTS public._mesa_session_mesas_check_store();
DROP FUNCTION IF EXISTS public._mesa_sessions_no_reopen();

NOTIFY pgrst, 'reload schema';

COMMIT;
