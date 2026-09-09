-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 6 — ROLLBACK
-- Restaura _registrar_criacao_pagamento ao texto EXATO da Onda 3 (sem o mapeamento de
-- payment_method real -- rollback desfaz a migration, nao decide se o estado anterior era melhor).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._registrar_criacao_pagamento(p_payment_intent_id uuid, p_store_id_esperado uuid, p_mp_payment_id text, p_status text, p_status_detail text, p_raw_payload jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_pi RECORD;
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
    RETURN public._processar_webhook_payment_intent(p_mp_payment_id, p_status, p_status_detail, p_store_id_esperado, p_raw_payload);
  END IF;

  UPDATE public.payment_intents
  SET mp_payment_id = p_mp_payment_id, status = p_status, status_detail = p_status_detail,
      raw_payload = coalesce(p_raw_payload, raw_payload), updated_at = now()
  WHERE id = v_pi.id;

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

  BEGIN
    INSERT INTO public.application_logs(module, operation, entity, entity_id, request_id, rpc, version, duration_ms, level, message, payload, sqlstate, context, origin)
    VALUES ('pagamento', 'criar_cobranca_mercadopago', 'payment_intent', v_pi.id, NULL, '_registrar_criacao_pagamento', 'pagamento-01-onda3', NULL, 'info',
      format('payment_intent %s: criado no MP como %s (%s)', v_pi.id, p_mp_payment_id, p_status), p_raw_payload, NULL, 'criacao', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'mp_payment_id', p_mp_payment_id, 'status', p_status);
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
