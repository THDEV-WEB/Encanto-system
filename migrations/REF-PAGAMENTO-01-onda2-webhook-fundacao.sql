-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 2 — Fundação do webhook (credential-independent)
-- ----------------------------------------------------------------------------
-- ESCOPO EXPLÍCITO: só a LÓGICA que não depende de credencial real do Mercado
-- Pago -- validação de assinatura HMAC, máquina de estados, processamento
-- idempotente, expiração de 15min. NENHUMA chamada real à API do Mercado Pago
-- nesta onda (bloqueado, ver docs/ref/REF-PAGAMENTO-01-checkpoint.md).
-- create_order()/_resolve_delivery_fee() continuam INTOCADOS.
--
-- Todas as funções são INTERNAS (prefixo "_"), zero GRANT a ninguém -- serão
-- chamadas de dentro de uma Edge Function (service_role) ou RPC dedicada
-- numa onda futura, quando a decisão de transporte (Edge Function vs RPC
-- exposta via PostgREST) for tomada. Esta onda não decide isso -- só
-- constrói a lógica que qualquer transporte vai precisar de qualquer forma.
--
-- _hmac_sha256_hex / _validar_assinatura_webhook_mp: implementa o algoritmo
-- EXATO documentado oficialmente pelo Mercado Pago (manifest
-- "id:{data.id};request-id:{x-request-id};ts:{timestamp};", HMAC-SHA256 hex,
-- comparado ao "v1" do header x-signature). Timestamp fora de uma janela de
-- 10min (passado) / 2min (futuro) é rejeitado -- defesa em profundidade
-- ADICIONAL, não exigida pela doc oficial (que não define janela de frescor),
-- documentada explicitamente como decisão nossa, não do Mercado Pago.
--
-- _transicao_payment_status_valida: máquina de estados fechada --
-- pendente->{aprovado,recusado,expirado}; aprovado->{em_contestacao,
-- estornado}; em_contestacao->{estornado,aprovado} (disputa pode resolver a
-- favor do lojista). Qualquer outra combinação (incluindo regressão de
-- estado terminal) é rejeitada -- é essa máquina, não janela de tempo, que
-- protege contra replay de um webhook antigo tentando desfazer uma
-- confirmação mais recente.
--
-- _processar_webhook_payment_intent: idempotente por natureza -- mesmo
-- status recebido 2x é no-op (nunca re-executa efeito colateral). Valida
-- tenant (store_id) ANTES de qualquer escrita. 'aprovado' promove
-- orders.status 'aguardando_pagamento'->'recebido' (reaproveita a
-- notificação/WhatsApp já existente, trg_enc_order_notify, zero código
-- novo) e, se for de Mesa, marca a fatia correspondente como paga.
-- 'expirado' cancela o pedido (delivery/retirada); 'recusado' preserva o
-- pedido em aguardando_pagamento (permite nova tentativa, mesmo order_id).
--
-- _expirar_payment_intents_pendentes: job (pg_cron, mesmo mecanismo já
-- usado por REF-ORDER-01/REF-DELIVERY-FEE-05) varre pendentes há >15min e
-- expira + cancela o pedido associado (mesa allocation NÃO é auto-cancelada,
-- só o pedido de delivery/retirada -- ver corpo da função).
--
-- IMPORTANTE (transparência sobre simulação vs real): os testes desta onda
-- (scripts/pagamento-01-onda2-webhook-test.mjs) SIMULAM payment_intents via
-- INSERT direto (nunca criados pela API real do Mercado Pago, que segue
-- bloqueada) e webhooks ASSINADOS POR NÓS MESMOS com um secret de teste
-- gerado localmente -- provam que a MATEMÁTICA da validação está correta
-- (aceita assinatura válida, rejeita inválida/forjada/adulterada), não que a
-- integração real com o Mercado Pago funciona ponta a ponta.
--
-- ACHADO DURANTE O TESTE DESTA ONDA: orders.status tem um CHECK constraint
-- (orders_status_valid) que a Onda 0/1 não tinham detectado -- payment_method
-- é livre (sem enum, documentado 2x no código), mas status NÃO é. Lista atual
-- (confirmada por introspeção ao vivo): recebido/preparo/pronto/entrega/
-- entregue/cancelado. 'aguardando_pagamento' (especificado desde a Onda 0 §6
-- como o único valor novo necessário) não está incluído -- sem esta correção,
-- nenhum código futuro (nem esta onda, nem uma eventual mudança em
-- create_order()) conseguiria gravar esse status. Correção aditiva pura:
-- adiciona 'aguardando_pagamento' à lista existente, não remove nem altera
-- nenhum valor já permitido. create_order() continua INTOCADO -- ele nunca
-- grava esse valor hoje, só passa a ser um caminho VÁLIDO no schema pra
-- quando essa mudança (já prevista, não decidida ainda) for autorizada.
--
-- Testes: scripts/pagamento-01-onda2-webhook-test.mjs (E2E).
-- Rollback: REF-PAGAMENTO-01-onda2-webhook-fundacao-rollback.sql.
-- ============================================================================

BEGIN;

ALTER TABLE public.orders DROP CONSTRAINT orders_status_valid;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_valid
  CHECK (status = ANY (ARRAY['recebido','preparo','pronto','entrega','entregue','cancelado','aguardando_pagamento']));

-- hmac() vive no schema "extensions" (convencao do Supabase pro pgcrypto, confirmado por
-- introspeccao ao vivo -- NAO em public/pg_catalog) -- chamada schema-qualificada explicita em vez
-- de alargar o search_path da funcao (mais seguro, evita ambiguidade de resolucao de funcao).
CREATE OR REPLACE FUNCTION public._hmac_sha256_hex(p_mensagem text, p_chave text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT encode(extensions.hmac(convert_to(p_mensagem, 'UTF8'), convert_to(p_chave, 'UTF8'), 'sha256'), 'hex');
$function$;
REVOKE ALL ON FUNCTION public._hmac_sha256_hex(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._validar_assinatura_webhook_mp(p_data_id text, p_x_request_id text, p_x_signature text, p_secret text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ts text;
  v_v1 text;
  v_manifest text;
  v_esperado text;
  v_ts_instant timestamptz;
BEGIN
  IF p_data_id IS NULL OR p_x_request_id IS NULL OR p_x_signature IS NULL OR p_secret IS NULL THEN
    RETURN false;
  END IF;

  v_ts := (regexp_match(p_x_signature, 'ts=([0-9]+)'))[1];
  v_v1 := (regexp_match(p_x_signature, 'v1=([0-9a-fA-F]+)'))[1];
  IF v_ts IS NULL OR v_v1 IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_ts_instant := to_timestamp(v_ts::numeric / 1000.0);
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  -- Defesa em profundidade ADICIONAL, nao exigida pela doc oficial do Mercado Pago (que nao define
  -- janela de frescor) -- ver cabecalho da migration.
  IF v_ts_instant < now() - interval '10 minutes' OR v_ts_instant > now() + interval '2 minutes' THEN
    RETURN false;
  END IF;

  -- Manifest EXATO documentado pelo Mercado Pago ("Webhooks - assinatura secreta"):
  -- id:{data.id};request-id:{x-request-id};ts:{timestamp};
  v_manifest := 'id:' || p_data_id || ';request-id:' || p_x_request_id || ';ts:' || v_ts || ';';
  v_esperado := public._hmac_sha256_hex(v_manifest, p_secret);
  RETURN v_esperado = lower(v_v1);
END;
$function$;
REVOKE ALL ON FUNCTION public._validar_assinatura_webhook_mp(text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._transicao_payment_status_valida(p_de text, p_para text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (p_de, p_para) IN (
    ('pendente', 'aprovado'), ('pendente', 'recusado'), ('pendente', 'expirado'),
    ('aprovado', 'em_contestacao'), ('aprovado', 'estornado'),
    ('em_contestacao', 'estornado'), ('em_contestacao', 'aprovado')
  );
$function$;
REVOKE ALL ON FUNCTION public._transicao_payment_status_valida(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._processar_webhook_payment_intent(p_mp_payment_id text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_raw_payload jsonb DEFAULT NULL)
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
REVOKE ALL ON FUNCTION public._processar_webhook_payment_intent(text, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Entrada única do webhook: valida assinatura ANTES de qualquer leitura/escrita, so' entao
-- processa. Nunca toca o banco se a assinatura for invalida. ────────────────────────────────
CREATE OR REPLACE FUNCTION public._webhook_mercadopago_recebido(p_data_id text, p_x_request_id text, p_x_signature text, p_novo_status text, p_status_detail text, p_store_id_esperado uuid, p_secret text, p_raw_payload jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public._validar_assinatura_webhook_mp(p_data_id, p_x_request_id, p_x_signature, p_secret) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assinatura invalida');
  END IF;
  RETURN public._processar_webhook_payment_intent(p_data_id, p_novo_status, p_status_detail, p_store_id_esperado, p_raw_payload);
END;
$function$;
REVOKE ALL ON FUNCTION public._webhook_mercadopago_recebido(text, text, text, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Expiração de 15min (política interna do Encanto, ver docs/ref/REF-PAGAMENTO-01-onda0-auditoria.md §10) ──
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
REVOKE ALL ON FUNCTION public._expirar_payment_intents_pendentes() FROM PUBLIC, anon, authenticated;

-- cron.schedule faz upsert (mesmo padrao ja usado por REF-ORDER-01b/REF-LGPD-01/REF-SEC-02) --
-- unschedule antes so' por seguranca caso a migration seja reaplicada.
SELECT cron.unschedule('encanto-pagamento-expira-intents') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'encanto-pagamento-expira-intents');
SELECT cron.schedule('encanto-pagamento-expira-intents', '*/5 * * * *', $$SELECT public._expirar_payment_intents_pendentes();$$);

NOTIFY pgrst, 'reload schema';

COMMIT;
