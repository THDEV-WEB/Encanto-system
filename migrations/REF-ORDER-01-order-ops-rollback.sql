-- ROLLBACK de REF-ORDER-01-order-ops.sql. Remove tudo que a migration criou. Idempotente.
-- NOTA: a migration remove qualquer CHECK de status pre-existente e cria `orders_status_check`. Este
-- rollback dropa `orders_status_check` (volta ao estado sem constraint nossa). Se havia uma constraint
-- original com outro nome, ela NAO e restaurada (nao temos a definicao original) — reaplique-a se preciso.
BEGIN;

DROP TRIGGER IF EXISTS trg_enc_order_status_change ON public.orders;
DROP TRIGGER IF EXISTS trg_enc_order_created       ON public.orders;

DROP FUNCTION IF EXISTS public.enc_on_order_status_change();
DROP FUNCTION IF EXISTS public.enc_on_order_created();
DROP FUNCTION IF EXISTS public.enc_claim_notifications(int);
DROP FUNCTION IF EXISTS public.enc_enqueue_notification(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.enc_tempo_estimado(text);
DROP FUNCTION IF EXISTS public.enc_actor_label();

DROP VIEW IF EXISTS public.order_status_durations;

DROP POLICY IF EXISTS notification_outbox_admin_read ON public.notification_outbox;
DROP TABLE IF EXISTS public.notification_outbox;

ALTER TABLE public.order_events DROP COLUMN IF EXISTS ator;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

COMMIT;
