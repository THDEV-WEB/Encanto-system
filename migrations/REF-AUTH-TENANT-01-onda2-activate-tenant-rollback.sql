-- Rollback da Onda 2 de REF-AUTH-TENANT-01.
-- Seguro enquanto a Onda 3 (Hook) nao existir - nada mais chama activate_tenant() ainda.

BEGIN;

DROP FUNCTION IF EXISTS public.activate_tenant(uuid);

COMMIT;
