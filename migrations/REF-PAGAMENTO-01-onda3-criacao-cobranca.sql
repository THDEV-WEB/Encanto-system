-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 3 — Criação de cobrança real (E2E apenas, sandbox MP)
-- ----------------------------------------------------------------------------
-- Primeira onda desta REF com credencial REAL de teste do Mercado Pago em uso
-- (Public Key + MP_ACCESS_TOKEN, projeto E2E bgzcrovskjbktdxkhemd). Produção
-- segue intocada -- create_order()/_resolve_delivery_fee() continuam
-- INTOCADOS por esta migration.
--
-- Correção de rota de secret (achado desta onda): o MP_ACCESS_TOKEN NÃO fica
-- no Postgres Vault (diferente do que a Onda 2 assumiu por analogia ao
-- WhatsApp) -- quem precisa dele é uma Edge Function (Deno), e toda Edge
-- Function já existente no projeto (route-distance, invite-store-admin) lê
-- segredo via `supabase secrets set`/Deno.env, nunca consultando o Vault do
-- Postgres direto (padrão inexistente no projeto). MP_ACCESS_TOKEN foi
-- REMOVIDO do Vault (onde tinha sido criado por engano) e recriado como
-- secret de Edge Function no projeto E2E.
--
-- iniciar_pagamento_pedido: RPC client-facing (mesma exposição anon+
-- authenticated de create_order, pois pedido pode ser de convidado). Recebe
-- só order_id -- cria (ou reaproveita, se já existir uma tentativa pendente
-- pro mesmo pedido) 1 payment_intents 'pendente'. Gate por capability
-- 'pagamento_online_habilitada' em store_settings (padrão EAV chave/valor já
-- usado por mesa_habilitada/mesa_canal_qr/etc via get_mesa_config) -- default
-- ausente = desabilitado, opt-in explícito por loja. Zero chamada à API do
-- Mercado Pago aqui -- só prepara o registro local.
--
-- _registrar_criacao_pagamento: função interna (chamada pela Edge Function,
-- service_role) que grava a resposta da CHAMADA DE CRIAÇÃO do pagamento (não
-- confundir com o webhook, Onda 2) -- é a 1ª escrita real de mp_payment_id
-- num payment_intent que nasceu sem ele. Não reaproveita a checagem de
-- idempotência de _processar_webhook_payment_intent (Onda 2) porque ali
-- "status igual" = replay; aqui, todo payment_intent nasce 'pendente' e a 1ª
-- resposta do MP também costuma vir 'pendente' -- não é replay, é a 1ª
-- escrita. Numa eventual 2ª chamada com o MESMO mp_payment_id (retry de rede
-- do lado do Edge Function, por exemplo), aí sim delega pra
-- _processar_webhook_payment_intent (Onda 2, já testada 29/29) em vez de
-- duplicar a lógica de transição/idempotência.
--
-- Decisão de API do Mercado Pago tomada nesta onda: /v1/payments (API
-- clássica), não a Orders API unificada -- é a integração server-side
-- OFICIALMENTE documentada pelo Mercado Pago para uso com Payment Brick
-- (exemplo de referência da própria doc do Brick usa /v1/payments). Orders
-- API fica mapeada pra quando/se Split 1:1 avançar (múltiplos recebedores
-- por pagamento) -- não é o caso de uma loja única recebendo hoje.
--
-- Testes: scripts/pagamento-01-onda3-criacao-cobranca-test.mjs (E2E) --
-- seção A (RPC, credential-independent) + seção B (chamada REAL à Edge
-- Function/sandbox MP, claramente separada e rotulada).
-- Rollback: REF-PAGAMENTO-01-onda3-criacao-cobranca-rollback.sql.
-- ============================================================================

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

  -- Reaproveita tentativa pendente existente em vez de criar outra (refresh/retry do cliente antes
  -- de submeter o Brick não deve acumular payment_intents órfãos pro mesmo pedido).
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
REVOKE ALL ON FUNCTION public.iniciar_pagamento_pedido(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iniciar_pagamento_pedido(uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public._registrar_criacao_pagamento(p_payment_intent_id uuid, p_store_id_esperado uuid, p_mp_payment_id text, p_status text, p_status_detail text, p_raw_payload jsonb DEFAULT NULL)
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
    VALUES ('pagamento', 'criar_cobranca_mercadopago', 'payment_intent', v_pi.id, NULL, '_registrar_criacao_pagamento', 'pagamento-01-onda3', NULL, 'info',
      format('payment_intent %s: criado no MP como %s (%s)', v_pi.id, p_mp_payment_id, p_status), p_raw_payload, NULL, 'criacao', current_user);
  EXCEPTION WHEN others THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'mp_payment_id', p_mp_payment_id, 'status', p_status);
END;
$function$;
REVOKE ALL ON FUNCTION public._registrar_criacao_pagamento(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
