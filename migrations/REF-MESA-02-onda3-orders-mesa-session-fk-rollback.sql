-- ============================================================================
-- REF-MESA-02 · Onda 3 — ROLLBACK
-- Seguro enquanto nenhuma linha real de orders tiver mesa_session_id
-- preenchido (garantido -- nenhuma RPC grava nele ainda). Remove triggers,
-- constraint, coluna e indice; DROP FUNCTION das 2 funcoes de trigger.
-- ============================================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_orders_mesa_session_immutable ON public.orders;
DROP TRIGGER IF EXISTS trg_orders_mesa_session_check_store ON public.orders;

DROP FUNCTION IF EXISTS public._orders_mesa_session_immutable();
DROP FUNCTION IF EXISTS public._orders_mesa_session_check_store();

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_mesa_session_id_coerente;
DROP INDEX IF EXISTS public.orders_mesa_session_id_idx;
ALTER TABLE public.orders DROP COLUMN IF EXISTS mesa_session_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
