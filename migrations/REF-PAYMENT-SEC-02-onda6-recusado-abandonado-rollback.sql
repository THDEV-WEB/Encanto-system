-- Rollback REF-PAYMENT-SEC-02 · Onda 6 — restaura _expirar_payment_intents_pendentes ao estado
-- anterior (so' cobre payment_intents 'pendente', nao toca pedidos com pagamento 'recusado').
BEGIN;

CREATE OR REPLACE FUNCTION public._expirar_payment_intents_pendentes()
 RETURNS integer
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH expirados AS (
    UPDATE public.payment_intents
    SET status = 'expirado', updated_at = now()
    WHERE status = 'pendente' AND created_at < now() - interval '15 minutes'
    RETURNING id, order_id
  ),
  pedidos_cancelados AS (
    UPDATE public.orders o
    SET status = 'cancelado', payment_status = 'expirado'
    FROM expirados e
    WHERE o.id = e.order_id AND o.status = 'aguardando_pagamento'
    RETURNING o.id
  )
  SELECT count(*)::integer FROM expirados;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
