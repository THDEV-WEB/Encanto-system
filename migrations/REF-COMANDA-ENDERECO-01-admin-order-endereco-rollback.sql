-- Rollback REF-COMANDA-ENDERECO-01
-- Remove a RPC de leitura. Nao afeta orders/addresses (nada foi alterado nelas por esta migration).

BEGIN;

DROP FUNCTION IF EXISTS public.admin_order_endereco(uuid);

COMMIT;

NOTIFY pgrst, 'reload schema';
