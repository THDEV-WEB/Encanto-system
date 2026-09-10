-- Rollback REF-PAYMENT-SEC-02 · Onda 2 — restaura _processar_webhook_payment_intent() para o
-- estado exato pos-Onda 1 (pre-Onda 2), sem o branch 'estornado'.
BEGIN;

CREATE OR REPLACE FUNCTION public._processar_webhook_payment_intent(p_mp_payment_id text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
  v_customer_id uuid;
BEGIN
  IF p_mp_payment_id IS NULL OR p_novo_status IS NULL OR p_store_id_esperado IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parametros obrigatorios ausentes');
  END IF;

  SELECT * INTO v_pi FROM public.payment_intents
  WHERE mp_payment_id = p_mp_payment_id
  FOR UPDATE;

  IF v_pi.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent nao encontrado');
  END IF;

  -- Nunca escreve nada se o tenant nao corresponde -- mesma dupla-checagem ja provada na Onda 16
  -- da REF-MESA-02 contra payload forjado apontando pra recurso de outra loja.
  IF v_pi.store_id <> p_store_id_esperado THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant nao corresponde');
  END IF;

  -- Idempotencia: mesmo status ja registrado -> no-op, nunca reexecuta efeito colateral.
  IF v_pi.status = p_novo_status THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true, 'status', v_pi.status);
  END IF;

  IF NOT public._transicao_payment_status_valida(v_pi.status, p_novo_status) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transicao de status invalida', 'de', v_pi.status, 'para', p_novo_status);
  END IF;

  UPDATE public.payment_intents
  SET status = p_novo_status, status_detail = p_status_detail,
      raw_payload = coalesce(p_raw_payload, raw_payload), updated_at = now()
  WHERE id = v_pi.id;

  IF p_novo_status = 'aprovado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'recebido', payment_status = 'aprovado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
      -- REF-PAYMENT-SEC-02 · Onda 4: pedido NAO estava mais aguardando_pagamento (ja expirado/
      -- cancelado antes deste webhook tardio) -- nunca reabre o pedido sozinho (decisao de negocio
      -- fora do escopo desta correcao). So registra o FATO financeiro (dinheiro chegou) e sinaliza
      -- pra reconciliacao manual, nunca finge que nada aconteceu.
      IF NOT FOUND THEN
        UPDATE public.orders SET payment_status = 'aprovado' WHERE id = v_pi.order_id;
        BEGIN
          INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
          VALUES ('pagamento', 'webhook_mercadopago', 'order', v_pi.order_id, NULL, '_processar_webhook_payment_intent', 'payment-sec-02-onda4', NULL, 'warn',
            format('RECONCILIACAO NECESSARIA: payment_intent %s aprovado para o pedido %s, que NAO estava aguardando_pagamento (provavelmente ja expirado/cancelado) -- dinheiro recebido, pedido NAO reaberto automaticamente, requer tratamento administrativo', v_pi.id, v_pi.order_id),
            p_raw_payload, NULL, 'webhook_reconciliacao', current_user);
        EXCEPTION WHEN others THEN NULL;
        END;
      ELSE
        -- REF-PAYMENT-SEC-02 · Onda 1 (achado HIGH-01): pedido online REALMENTE confirmado agora --
        -- concede o selo aqui (deferido desde create_order). Nunca no ramo "IF NOT FOUND" acima
        -- (pedido nao reaberto -> nao ganha selo, coerente com a Onda 4). Falha de fidelidade nunca
        -- quebra o pagamento (mesmo padrao ja usado em create_order).
        SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_pi.order_id;
        IF v_customer_id IS NOT NULL THEN
          BEGIN
            PERFORM public.loyalty_grant(v_customer_id, v_pi.order_id);
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END IF;
    END IF;
    IF v_pi.mesa_session_id IS NOT NULL THEN
      UPDATE public.mesa_session_payment_allocations
      SET status = 'pago', paga_em = now()
      WHERE payment_intent_id = v_pi.id AND status = 'pendente';
    END IF;
  ELSIF p_novo_status = 'expirado' THEN
    -- So cancela o PEDIDO (delivery/retirada) -- fatia de mesa nao e auto-cancelada, a sessao
    -- continua precisando daquele valor por outro meio (nova tentativa online ou presencial).
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'cancelado', payment_status = 'expirado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
    END IF;
  ELSIF p_novo_status = 'recusado' THEN
    -- Preserva o pedido em aguardando_pagamento -- permite nova tentativa com o MESMO order_id
    -- (novo payment_intent), nunca duplica o pedido.
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET payment_status = 'recusado' WHERE id = v_pi.order_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
    VALUES ('pagamento', 'webhook_mercadopago', 'payment_intent', v_pi.id, NULL, '_processar_webhook_payment_intent', 'pagamento-01-onda2', NULL, 'info',
      format('payment_intent %s: %s -> %s', v_pi.id, v_pi.status, p_novo_status), p_raw_payload, NULL, 'webhook', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'status', p_novo_status);
END;
$function$
;

NOTIFY pgrst, 'reload schema';

COMMIT;
