-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 5 — RPCs client-facing: capability de pagamento online + consulta de status
-- ----------------------------------------------------------------------------
-- Base pro Payment Brick (Pix) no frontend. Migration aditiva pura -- zero
-- alteração de create_order()/_resolve_delivery_fee()/orders/payment_intents.
--
-- get_pagamento_config: espelha get_mesa_config 1:1 (mesmo padrão EAV chave/
-- valor de store_settings, ausente=desligado, opt-in por loja). public_key
-- vai junto porque é PÚBLICA por design do próprio Mercado Pago (documentado
-- desde a arquitetura, §3) -- não é segredo, nenhum problema em devolver via
-- RPC anon.
--
-- consultar_status_pagamento: única forma do CLIENTE saber se o Pix foi pago
-- de verdade (a tela de espera faz polling nela) -- devolve só status +
-- order_id, nunca amount/raw_payload/outros dados do payment_intent. Exige
-- conhecer o payment_intent_id (UUID aleatório, devolvido só pra quem criou
-- a cobrança momentos antes) -- mesmo nível de "posse implícita" já usado em
-- outros fluxos de convidado do projeto (nenhuma autenticação nova exigida).
-- Rate limit generoso (polling legítimo esperado a cada poucos segundos
-- durante a espera do Pix, até os 15min de expiração interna).
--
-- Testes: scripts/pagamento-01-onda5-config-status-test.mjs (E2E).
-- Rollback: REF-PAGAMENTO-01-onda5-config-e-status-cliente-rollback.sql.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_pagamento_config(p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT jsonb_build_object(
    'habilitada', COALESCE((SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'pagamento_online_habilitada'), 'false') <> 'false',
    'public_key', (SELECT valor FROM public.store_settings WHERE store_id = p_store_id AND chave = 'mp_public_key')
  );
$function$;
REVOKE ALL ON FUNCTION public.get_pagamento_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pagamento_config(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.consultar_status_pagamento(p_payment_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_order_id uuid;
BEGIN
  IF NOT public._rate_limit_hit('consultar_status_pagamento', 120, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  END IF;
  IF p_payment_intent_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_id obrigatorio');
  END IF;

  SELECT status, order_id INTO v_status, v_order_id FROM public.payment_intents WHERE id = p_payment_intent_id;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent nao encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', v_status, 'order_id', v_order_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.consultar_status_pagamento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_status_pagamento(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
