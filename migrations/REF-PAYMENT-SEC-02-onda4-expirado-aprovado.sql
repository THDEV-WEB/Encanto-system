-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 4 — permite a transição expirado→aprovado na máquina de estados de
-- payment_intents, SEM reabrir o pedido automaticamente (achado MEDIUM-02 da REF-PAYMENT-SEC-01,
-- seção 10, já causou 1 incidente real em produção nesta mesma sessão: pedido a9c06490..., R$2,00,
-- dinheiro confirmado na conta Mercado Pago do dono, mas o webhook de aprovação (quando chegasse)
-- seria recusado porque _expirar_payment_intents_pendentes já tinha marcado tudo como expirado).
--
-- RECONSTRUÇÃO DO INCIDENTE (exigida antes de implementar, seção 10.1): a única forma de um
-- payment_intent chegar em 'aprovado' é via _processar_webhook_payment_intent, chamada SÓ pelo
-- mp-webhook (Edge Function) depois de (1) validar a assinatura HMAC do Mercado Pago e (2) refazer
-- um GET /v1/payments/{id} real na API do Mercado Pago -- nunca confia no body do webhook. Ou seja:
-- mesmo com a transição liberada, 'aprovado' só é alcançado com evidência real e revalidada do
-- provedor (seção 10.3 cumprida por construção, não é algo novo desta migration).
--
-- DECISÃO (a única fatia desta correção que envolve escolha de comportamento, seção 10.2 opções
-- A-F): quando o payment_intent expirado é aprovado tardiamente, o PEDIDO NÃO é reaberto
-- automaticamente (orders.status permanece como está, ex. 'cancelado') -- reabrir status tem efeito
-- colateral operacional real (cozinha, WhatsApp automático, fidelidade) que esta correção NÃO tem
-- autoridade pra decidir sozinha. Em vez disso: o FATO financeiro real (dinheiro chegou) é
-- registrado em orders.payment_status='aprovado' (nunca se perde a informação), e um log de nível
-- WARN é gravado em application_logs sinalizando "RECONCILIACAO NECESSARIA" para tratamento
-- administrativo -- opção "gera reconciliação" + "exige tratamento administrativo" dentre as listadas
-- na seção 10.2, as únicas que não inventam uma regra de negócio nova (reabrir pedido) por conta
-- própria. Mesmo tratamento aplicado em _registrar_criacao_pagamento (caminho de aprovação
-- instantânea, ex. cartão) por simetria/defesa em profundidade, embora o cenário ali seja bem mais
-- raro (a associação inicial acontece segundos depois da criação da cobrança).
--
-- Nenhuma outra linha das funções muda -- idempotência, tenant check, mesa_session_payment_
-- allocations, mapeamento de payment_method: tudo 100% preservado.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public._transicao_payment_status_valida(p_de text, p_para text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (p_de, p_para) IN (
    ('pendente', 'aprovado'), ('pendente', 'recusado'), ('pendente', 'expirado'),
    ('aprovado', 'em_contestacao'), ('aprovado', 'estornado'),
    ('em_contestacao', 'estornado'), ('em_contestacao', 'aprovado'),
    -- REF-PAYMENT-SEC-02 · Onda 4: webhook de aprovação pode chegar DEPOIS da expiração interna de
    -- 15min (incidente real, ver cabeçalho desta migration) -- o pagamento aconteceu de verdade,
    -- recusar a transição só esconderia o fato, nunca o desfaz.
    ('expirado', 'aprovado')
  );
$function$;

CREATE OR REPLACE FUNCTION public._processar_webhook_payment_intent(p_mp_payment_id text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
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
$function$;

CREATE OR REPLACE FUNCTION public._registrar_criacao_pagamento(p_payment_intent_id uuid, p_store_id_esperado uuid, p_mp_payment_id text, p_status text, p_status_detail text, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
  v_payment_method_real text;
BEGIN
  IF p_payment_intent_id IS NULL OR p_mp_payment_id IS NULL OR p_status IS NULL OR p_store_id_esperado IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'parametros obrigatorios ausentes');
  END IF;

  SELECT * INTO v_pi FROM public.payment_intents WHERE id = p_payment_intent_id FOR UPDATE;
  IF v_pi.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent nao encontrado');
  END IF;
  IF v_pi.store_id <> p_store_id_esperado THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant nao corresponde');
  END IF;

  IF v_pi.mp_payment_id IS NOT NULL THEN
    IF v_pi.mp_payment_id <> p_mp_payment_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_intent ja associado a outro pagamento no MP');
    END IF;
    -- Mesmo mp_payment_id de novo (ex.: retry de rede do lado da Edge Function) -- dai em diante e'
    -- uma transicao normal, delega pra maquina de estados/idempotencia ja testada da Onda 2 em vez
    -- de duplicar aquela logica aqui.
    RETURN public._processar_webhook_payment_intent(p_mp_payment_id, p_status, p_status_detail, p_store_id_esperado, p_raw_payload);
  END IF;

  -- 1a associacao: sempre grava (mesmo se p_status vier 'pendente', igual ao default inicial --
  -- NAO e' idempotencia de replay, e' a 1a escrita real da resposta da API de criacao).
  UPDATE public.payment_intents
  SET mp_payment_id = p_mp_payment_id, status = p_status, status_detail = p_status_detail,
      raw_payload = coalesce(p_raw_payload, raw_payload), updated_at = now()
  WHERE id = v_pi.id;

  -- REF-PAGAMENTO-01 · Onda 6: mapeia o tipo REAL devolvido pelo Mercado Pago pro vocabulario ja
  -- existente do projeto -- tipo desconhecido/ausente nao sobrescreve nada.
  v_payment_method_real := CASE p_raw_payload->>'payment_type_id'
    WHEN 'credit_card' THEN 'cartao_credito'
    WHEN 'debit_card'  THEN 'cartao_debito'
    WHEN 'bank_transfer' THEN 'pix'
    ELSE NULL
  END;
  IF v_payment_method_real IS NOT NULL AND v_pi.order_id IS NOT NULL THEN
    UPDATE public.orders SET payment_method = v_payment_method_real WHERE id = v_pi.order_id;
  END IF;

  IF p_status = 'aprovado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET status = 'recebido', payment_status = 'aprovado'
      WHERE id = v_pi.order_id AND status = 'aguardando_pagamento';
      -- REF-PAYMENT-SEC-02 · Onda 4: mesma defesa em profundidade do webhook (ver
      -- _processar_webhook_payment_intent) -- cenario bem mais raro aqui (1a associacao acontece
      -- segundos depois da criacao da cobranca), mas nao custa nada cobrir por simetria.
      IF NOT FOUND THEN
        UPDATE public.orders SET payment_status = 'aprovado' WHERE id = v_pi.order_id;
        BEGIN
          INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
          VALUES ('pagamento', 'criar_cobranca_mercadopago', 'order', v_pi.order_id, NULL, '_registrar_criacao_pagamento', 'payment-sec-02-onda4', NULL, 'warn',
            format('RECONCILIACAO NECESSARIA: payment_intent %s aprovado na criacao para o pedido %s, que NAO estava aguardando_pagamento -- dinheiro recebido, pedido NAO reaberto automaticamente, requer tratamento administrativo', v_pi.id, v_pi.order_id),
            p_raw_payload, NULL, 'webhook_reconciliacao', current_user);
        EXCEPTION WHEN others THEN NULL;
        END;
      END IF;
    END IF;
    IF v_pi.mesa_session_id IS NOT NULL THEN
      UPDATE public.mesa_session_payment_allocations
      SET status = 'pago', paga_em = now()
      WHERE payment_intent_id = v_pi.id AND status = 'pendente';
    END IF;
  ELSIF p_status = 'recusado' THEN
    IF v_pi.order_id IS NOT NULL THEN
      UPDATE public.orders SET payment_status = 'recusado' WHERE id = v_pi.order_id;
    END IF;
  END IF;
  -- 'expirado' nao e' devolvido pela API de CRIACAO (so' o job interno de expiracao chega la) --
  -- omitido de proposito, diferente do leque de status tratado pelo webhook.

  BEGIN
    INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
    VALUES ('pagamento', 'criar_cobranca_mercadopago', 'payment_intent', v_pi.id, NULL, '_registrar_criacao_pagamento', 'pagamento-01-onda6', NULL, 'info',
      format('payment_intent %s: criado no MP como %s (%s)', v_pi.id, p_mp_payment_id, p_status), p_raw_payload, NULL, 'criacao', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'mp_payment_id', p_mp_payment_id, 'status', p_status);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
