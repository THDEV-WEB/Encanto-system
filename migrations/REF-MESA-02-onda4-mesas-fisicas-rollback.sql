-- ============================================================================
-- REF-MESA-02 · Onda 4 — ROLLBACK
-- Greenfield: DROP das 3 RPCs + DROP TABLE mesas.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.admin_set_mesa_status(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.admin_criar_mesa(text, uuid);
DROP FUNCTION IF EXISTS public.admin_listar_mesas(uuid);
DROP TABLE IF EXISTS public.mesas CASCADE;

NOTIFY pgrst, 'reload schema';

COMMIT;
