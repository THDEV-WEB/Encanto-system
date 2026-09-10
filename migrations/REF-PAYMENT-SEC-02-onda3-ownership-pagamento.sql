-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-PAYMENT-SEC-02 · Onda 3 — iniciar_pagamento_pedido() passa a verificar POSSE do pedido antes
-- de criar/devolver um payment_intent (achado MEDIUM-01 da REF-PAYMENT-SEC-01).
--
-- ACHADO (auditoria REF-PAYMENT-SEC-01, seção 9): a função checava apenas `id = p_order_id AND
-- store_id = p_store_id` -- nenhuma verificação de que o CHAMADOR é o dono do pedido. Qualquer
-- pessoa que soubesse (ou vazasse) um order_id + seu store_id conseguia iniciar pagamento de um
-- pedido ALHEIO e ver o valor (`amount`) dele. Grantada tanto pra anon quanto authenticated.
--
-- FIX (menor alteração possível, mesmo padrão JÁ usado em create_order() para checar posse de
-- endereco_id -- REF-ORDER-TENANT-01/ADDRESS-STOREID-01):
--   - Cliente LOGADO (auth.uid() IS NOT NULL): o pedido precisa pertencer a um customer cujo
--     auth_user_id seja o dele, na mesma loja. Nunca confia em customer_id enviado pelo client --
--     deriva tudo de auth.uid() (JWT assinado pelo Supabase Auth).
--   - GUEST (auth.uid() IS NULL): o pedido precisa ser de um customer SEM auth_user_id vinculado
--     (ou seja, um pedido genuinamente de guest). Bloqueia o caso de maior risco -- um anônimo
--     tentando iniciar pagamento de um pedido que pertence a uma CONTA REAL -- mas não resolve
--     (não tem como resolver sem inventar infraestrutura nova de sessão de guest, fora do escopo
--     desta correção mínima) o caso guest-contra-guest: quem sabe o order_id de outro guest ainda
--     consegue iniciar pagamento daquele pedido. Risco residual documentado, não escondido.
--   - Em AMBOS os casos de negação, a mensagem devolvida é a MESMA de "pedido não encontrado" --
--     nunca revela se o pedido existe mas não é do chamador (evita virar oráculo de enumeração).
--
-- Nenhuma outra linha da função muda -- rate limit, habilitação da capability, reaproveitamento de
-- payment_intent pendente, criação de novo: tudo 100% preservado.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
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

  SELECT id, status, total, customer_id INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pedido nao encontrado');
  END IF;

  -- REF-PAYMENT-SEC-02 · Onda 3: checagem de posse -- mesmo padrao ja usado em create_order() para
  -- endereco_id. Mensagem de erro IDENTICA ao "nao encontrado" acima, de proposito (nunca revela
  -- se o pedido existe mas pertence a outra pessoa).
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = v_order.customer_id AND c.auth_user_id = auth.uid() AND c.store_id = p_store_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pedido nao encontrado');
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = v_order.customer_id AND c.auth_user_id IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'pedido nao encontrado');
    END IF;
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

NOTIFY pgrst, 'reload schema';

COMMIT;
