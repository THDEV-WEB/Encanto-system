-- Rollback da Onda 1 de REF-AUTH-TENANT-01.
-- Seguro em qualquer momento enquanto Ondas 2/3 não existirem (nada mais referencia
-- esta tabela ainda). DROP TABLE já remove índice, RLS e comentários junto.

BEGIN;

DROP TABLE IF EXISTS public.active_tenant;

COMMIT;
