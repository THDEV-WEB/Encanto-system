-- ============================================================================
-- REF-MESA-02 · Onda 15 (impressão do QR) — ROLLBACK
-- Aditiva pura -- nenhuma funcao existente foi alterada, so remove a RPC nova.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_obter_url_storefront(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
