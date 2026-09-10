-- Rollback REF-PAYMENT-SEC-02 · Onda 5 — remove a trigger/função de proteção de payment_status.
BEGIN;

DROP TRIGGER IF EXISTS trg_orders_payment_status_guard ON public.orders;
DROP FUNCTION IF EXISTS public._orders_payment_status_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;
