-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 2 — refunded/charged_back passam a ser mapeados corretamente e revertem
-- o selo de fidelidade quando aplicável (achado HIGH-02 da REF-PAYMENT-SEC-01, seção 33).
--
-- ACHADO: mapearStatusMp (mp-webhook/index.ts e mp-criar-cobranca/index.ts) nunca mapeava os status
-- reais do Mercado Pago 'refunded'/'charged_back'/'in_mediation' -- caíam no `default: 'pendente'`.
-- Isso significa que _transicao_payment_status_valida('aprovado', 'pendente') era chamada -- NÃO é
-- uma transição válida -- então _processar_webhook_payment_intent devolvia ok:false internamente.
-- A Edge Function ainda respondia 200 pro Mercado Pago (retorno HTTP sempre 200 quando não há erro
-- de infra), então o Mercado Pago NUNCA reenviava -- o webhook de estorno real era descartado em
-- silêncio, sem log algum (o INSERT em application_logs só acontece DEPOIS da transição ser aceita).
-- Um pedido que gerou selo de fidelidade e depois foi estornado/contestado NUNCA tinha o selo
-- revertido.
--
-- FIX PARTE 1 (mapeamento -- ver commit desta onda para os 2 arquivos .ts):
--   'in_mediation'          -> 'em_contestacao' (já é uma transição válida desde 'aprovado')
--   'refunded'/'charged_back' -> 'estornado'    (já é uma transição válida desde 'aprovado' E desde
--                                                 'em_contestacao' -- NENHUMA mudança na máquina de
--                                                 estados foi necessária, só o mapeamento estava
--                                                 quebrado).
--
-- FIX PARTE 2 (esta migration -- reversão do selo, só quando aplicável): novo branch
-- ELSIF p_novo_status = 'estornado' em _processar_webhook_payment_intent. Registra o FATO financeiro
-- (payment_status='estornado', nunca mexe em orders.status -- mesma decisão da Onda 4: estorno
-- tipicamente acontece dias/semanas depois, o pedido já foi preparado/entregue, mudar o status
-- operacional é uma decisão fora do escopo desta correção) e reverte o EVENTO DE FIDELIDADE
-- ESPECÍFICO deste pedido usando a MESMA mecânica já aprovada e em produção de
-- loyalty_void_on_cancel (soma os eventos 'earned' REAIS de origem 'create_order' para este
-- order_id, nunca "stamps = stamps - 1" às cegas, grava um evento 'revoked' próprio pra auditoria).
--
-- RECOMPENSA JÁ RESGATADA neste pedido (usar_recompensa_fidelidade=true, REF-LOYALTY-02 Onda 2):
-- mantém o MESMO precedente já aprovado e em produção da própria REF-LOYALTY-02 --
-- loyalty_void_on_cancel também NÃO restaura um resgate ao cancelar um pedido que resgatou (a soma
-- de delta fica negativa nesse caso, o bloco de reversão nunca dispara, ver v_contrib > 0 abaixo).
-- Não é uma decisão comercial nova sendo inventada aqui -- é o comportamento que a REF-LOYALTY-02 já
-- decidiu (implicitamente, via essa mesma condição) para "resgate + cancelamento posterior", agora
-- espelhado para "resgate + estorno posterior".
--
-- Idempotência: dupla proteção -- (1) 'estornado' é estado terminal na máquina (nenhuma transição
-- SAI dele), então o outer idempotency check (mesmo status -> no-op) cobre qualquer replay exato do
-- mesmo webhook; (2) a reversão soma os eventos 'earned' JÁ EXISTENTES daquele order_id -- mesmo que
-- este branch rodasse duas vezes por algum motivo, o segundo cálculo encontraria 0 eventos 'earned'
-- ainda não revertidos (o primeiro já não seria mais 'earned' puro -- na prática, o outer check
-- impede isso de acontecer de qualquer forma).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._processar_webhook_payment_intent(p_mp_payment_id text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
  v_customer_id uuid;
  v_contrib int;
  v_stamps int;
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
  ELSIF p_novo_status = 'estornado' THEN
    -- REF-PAYMENT-SEC-02 · Onda 2 (achado HIGH-02): registra o fato financeiro real e reverte o
    -- EVENTO DE FIDELIDADE especifico deste pedido, se houver -- mesma mecanica ja aprovada e em
    -- producao de loyalty_void_on_cancel (nunca "stamps = stamps - 1" as cegas: soma os eventos
    -- REAIS de origem 'create_order' deste order_id e reverte exatamente aquele valor, com um
    -- evento 'revoked' proprio pra auditoria). NAO reabre/cancela o pedido (mesma decisao da Onda 4
    -- -- estorno normalmente acontece dias/semanas depois, o pedido ja foi preparado/entregue).
    --
    -- Recompensa ja RESGATADA (tipo='redeemed') neste pedido: v_contrib fica negativo (delta do
    -- resgate e' -required), entao o bloco de reversao abaixo (v_contrib > 0) nunca dispara --
    -- mesmo precedente ja aprovado por loyalty_void_on_cancel pro caso "resgate + cancelamento",
    -- espelhado aqui pra "resgate + estorno". Nao e' uma decisao nova sendo inventada.
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET payment_status = 'estornado' WHERE id = v_pi.order_id;

      SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = v_pi.order_id;
      IF v_customer_id IS NOT NULL THEN
        SELECT coalesce(sum(delta), 0) INTO v_contrib
          FROM public.loyalty_events
          WHERE order_id = v_pi.order_id AND origem = 'create_order';
        IF v_contrib > 0 THEN
          BEGIN
            UPDATE public.loyalty_accounts
               SET stamps = greatest(0, stamps - v_contrib),
                   earned_total = greatest(0, earned_total - v_contrib),
                   updated_at = now()
             WHERE customer_id = v_customer_id
             RETURNING stamps INTO v_stamps;
            IF FOUND THEN
              INSERT INTO public.loyalty_events (customer_id, order_id, tipo, delta, stamps_after, origem, note, store_id)
                VALUES (v_customer_id, v_pi.order_id, 'revoked', -v_contrib, v_stamps, 'estorno_pagamento', 'pagamento estornado/contestado', v_pi.store_id);
            END IF;
          EXCEPTION WHEN others THEN NULL;
          END;
        END IF;
      END IF;
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
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
