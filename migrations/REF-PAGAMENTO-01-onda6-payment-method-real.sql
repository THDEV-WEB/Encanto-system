-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 6 — orders.payment_method reflete o metodo REAL escolhido no Brick
-- ----------------------------------------------------------------------------
-- Ate aqui (Onda 5), todo pedido pago online nascia com payment_method='online' (generico -- a
-- escolha real entre Pix/cartao so acontece DENTRO do Payment Brick, depois que o pedido ja foi
-- criado). Com cartao online habilitado nesta onda, deixar payment_method preso em 'online' pra
-- SEMPRE faria relatorios por forma de pagamento (Admin) perderem a distincao pix/credito/debito
-- pra todo pedido pago online -- achado real, motivado diretamente por esta onda (nao existia
-- quando so Pix estava habilitado, ja que 'pix_online' na pratica so' podia MESMO ser pix).
--
-- _registrar_criacao_pagamento ganha 1 UPDATE aditivo (so' na 1a associacao, mesmo ponto que ja
-- gravava mp_payment_id pela 1a vez): mapeia p_raw_payload->>'payment_type_id' (vocabulario do
-- Mercado Pago) pro vocabulario JA EXISTENTE do projeto (dinheiro/pix/cartao_debito/cartao_credito
-- -- create_order usa esses mesmos valores desde sempre). Tipo desconhecido/ausente NAO sobrescreve
-- nada (mantem 'online', nunca grava um valor adivinhado).
--
-- SEGURO em relacao a fee: _resolve_delivery_fee so' roda DENTRO de create_order(), no momento da
-- CRIACAO do pedido -- ja calculou delivery_fee/maquininha_fee/adicional_pagamento_fee usando
-- 'online' (fora da lista de permissao = 0 de taxa extra, ver Onda 5) ANTES deste UPDATE existir.
-- Trocar payment_method depois, so' pra fins de relatorio, NUNCA recalcula fee nenhuma.
--
-- Testes: scripts/pagamento-01-onda6-payment-method-real-test.mjs (E2E).
-- Rollback: REF-PAGAMENTO-01-onda6-payment-method-real-rollback.sql (restaura o texto exato da Onda 3).
-- ============================================================================

BEGIN;

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
-- CREATE OR REPLACE preserva os grants existentes (REVOKE ALL da Onda 3 continua valendo).

NOTIFY pgrst, 'reload schema';

COMMIT;
