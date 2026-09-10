-- Rollback REF-PAYMENT-SEC-02 · Onda 3 — restaura iniciar_pagamento_pedido() sem a checagem de posse.
BEGIN;

CREATE OR REPLACE FUNCTION public.iniciar_pagamento_pedido(p_order_id uuid, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_habilitada boolean;
  v_order RECORD;
  v_pi_id uuid;
  v_idem uuid;
BEGIN
  IF NOT public._rate_limit_hit('iniciar_pagamento_pedido', 30, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  END IF;

  v_habilitada := COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'pagamento_online_habilitada'), 'false') <> 'false';
  IF NOT v_habilitada THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pagamento online nao habilitado para esta loja');
  END IF;

  SELECT id, status, total INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pedido nao encontrado');
  END IF;
  IF v_order.status <> 'aguardando_pagamento' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pedido nao esta aguardando pagamento');
  END IF;

  SELECT id, idempotency_key INTO v_pi_id, v_idem
  FROM public.payment_intents
  WHERE order_id = p_order_id AND status = 'pendente'
  ORDER BY created_at DESC LIMIT 1;

  IF v_pi_id IS NULL THEN
    INSERT INTO public.payment_intents (store_id, order_id, amount)
    VALUES (p_store_id, p_order_id, v_order.total)
    RETURNING id, idempotency_key INTO v_pi_id, v_idem;
  END IF;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi_id, 'idempotency_key', v_idem, 'amount', v_order.total);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
