-- ROLLBACK de REF-ORDER-01-order-ops.sql. Idempotente. NAO mexe no historico (trg_order_audit) — nunca foi
-- tocado por esta migration. Restaura o CHECK de status SEM 'pronto' (estado original do banco).
BEGIN;

DROP TRIGGER IF EXISTS trg_enc_order_notify ON public.orders;
DROP FUNCTION IF EXISTS public.enc_on_order_notify();
DROP FUNCTION IF EXISTS public.enc_claim_notifications(int);
DROP FUNCTION IF EXISTS public.enc_enqueue_notification(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.enc_tempo_estimado(text);

DROP VIEW IF EXISTS public.order_status_durations;

DROP POLICY IF EXISTS notification_outbox_admin_read ON public.notification_outbox;
DROP TABLE IF EXISTS public.notification_outbox;

-- volta o CHECK de status ao original (sem 'pronto')
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_valid;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_valid
  CHECK (status IN ('recebido','preparo','entrega','entregue','cancelado'));

COMMIT;
