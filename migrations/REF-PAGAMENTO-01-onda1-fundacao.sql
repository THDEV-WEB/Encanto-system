-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 1 — Fundação de schema (pagamento online + divisão de conta de Mesa)
-- ----------------------------------------------------------------------------
-- Só schema/RPC. ZERO chamada real ao Mercado Pago (bloqueado por credencial,
-- ver docs/ref/REF-PAGAMENTO-01-onda0-auditoria.md §8) — nenhuma Edge Function
-- criada nesta onda. create_order()/_resolve_delivery_fee() NÃO são tocadas.
--
-- payment_intents: 1 linha por tentativa de cobrança (Delivery/Retirada via
-- order_id, OU Mesa via mesa_session_id -- nunca os dois, CHECK abaixo). Nasce
-- 'pendente', nunca escrita por RPC client-facing além da criação -- a
-- transição pra 'aprovado'/'recusado' é sempre server-side (webhook, Onda 4,
-- ainda não implementado). RLS deny-all estrutural (mesmo padrão de
-- mesa_sessions, Onda 2 da REF-MESA-02) -- toda leitura/escrita passa por RPC
-- SECURITY DEFINER.
--
-- mesa_session_payment_allocations: divisão de conta de Mesa (requisito novo,
-- NÃO é Split Mercado Pago -- isso divide o valor entre PESSOAS PRESENTES na
-- mesa, nunca entre recebedores financeiros). Aditivo sobre o modelo da
-- REF-MESA-02: sessão sem nenhuma linha aqui comporta-se EXATAMENTE como
-- antes (admin_fechar_conta_mesa intocado nesse caminho). Sessão COM linhas
-- exige todas 'pago' antes de fechar (guarda nova, aditiva, ver
-- admin_fechar_conta_mesa abaixo).
--
-- orders.payment_status: NULL para todo pedido COD (comportamento 100%
-- preservado, é o default e continua sendo pra sempre). Só populado quando a
-- loja liga a capability pagamento_online_habilitada E o cliente escolhe um
-- método online -- capability opt-in, mesmo idioma de mesa_sessao_habilitada.
--
-- Testes: scripts/pagamento-01-onda1-fundacao-test.mjs (E2E).
-- Rollback: REF-PAGAMENTO-01-onda1-fundacao-rollback.sql.
-- ============================================================================

BEGIN;

CREATE TABLE public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL DEFAULT default_store_id() REFERENCES public.stores(id),
  order_id uuid NULL REFERENCES public.orders(id),
  mesa_session_id uuid NULL REFERENCES public.mesa_sessions(id),
  provider text NOT NULL DEFAULT 'mercadopago',
  mp_payment_id text NULL,
  status text NOT NULL DEFAULT 'pendente',
  status_detail text NULL,
  amount numeric(10,2) NOT NULL,
  idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  raw_payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_origem_unica CHECK (
    (order_id IS NOT NULL AND mesa_session_id IS NULL) OR
    (order_id IS NULL AND mesa_session_id IS NOT NULL)
  ),
  CONSTRAINT payment_intents_amount_positivo CHECK (amount > 0),
  CONSTRAINT payment_intents_idempotency_key_unica UNIQUE (idempotency_key)
);
CREATE INDEX payment_intents_order_id_idx ON public.payment_intents (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX payment_intents_mesa_session_id_idx ON public.payment_intents (mesa_session_id) WHERE mesa_session_id IS NOT NULL;
CREATE INDEX payment_intents_store_id_idx ON public.payment_intents (store_id);
-- Lookup do webhook é sempre por mp_payment_id -- índice parcial (nulo até a 1a resposta do MP).
CREATE INDEX payment_intents_mp_payment_id_idx ON public.payment_intents (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

-- Deny-all estrutural (mesmo padrão de mesa_sessions/mesa_session_mesas, Onda 2 da REF-MESA-02) --
-- ZERO CREATE POLICY, toda leitura/escrita passa por RPC SECURITY DEFINER com is_admin_of/
-- WHERE store_id explícito. anon/authenticated nunca leem/escrevem a tabela diretamente.
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_intents FROM anon, authenticated;

CREATE TABLE public.mesa_session_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesa_session_id uuid NOT NULL REFERENCES public.mesa_sessions(id),
  store_id uuid NOT NULL DEFAULT default_store_id() REFERENCES public.stores(id),
  valor numeric(10,2) NOT NULL CHECK (valor > 0),
  metodo text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  payment_intent_id uuid NULL REFERENCES public.payment_intents(id),
  paga_em timestamptz NULL,
  registrada_por_admin_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mesa_session_payment_allocations_session_idx ON public.mesa_session_payment_allocations (mesa_session_id);

ALTER TABLE public.mesa_session_payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mesa_session_payment_allocations FROM anon, authenticated;

-- orders.payment_status: nullable, sem CHECK/enum -- MESMO padrão já documentado 2x no projeto pra
-- payment_method (create_order + admin_fechar_conta_mesa): frontend/RPC oferecem os valores
-- conhecidos, servidor só usa em comparação explícita. NULL = "não aplicável" (COD), preservado
-- pra sempre em todo pedido existente e futuro que não usar pagamento online.
ALTER TABLE public.orders ADD COLUMN payment_status text NULL;

-- ── admin_dividir_conta_mesa: cria a divisão (fatias 'pendente'), valida SUM = total autoritativo ──
CREATE OR REPLACE FUNCTION public.admin_dividir_conta_mesa(p_mesa_session_id uuid, p_alocacoes jsonb, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_total numeric;
  v_soma numeric;
  v_elem jsonb;
  v_valor numeric;
  v_metodo text;
  v_ids jsonb := '[]'::jsonb;
  v_novo_id uuid;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  SELECT status INTO v_status FROM public.mesa_sessions
  WHERE id = p_mesa_session_id AND store_id = p_store_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao nao encontrada');
  END IF;
  IF v_status <> 'aberta' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao ja fechada');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mesa_session_payment_allocations
    WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao ja tem divisao de conta criada');
  END IF;

  IF p_alocacoes IS NULL OR jsonb_typeof(p_alocacoes) <> 'array' OR jsonb_array_length(p_alocacoes) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'informe pelo menos 2 fatias');
  END IF;

  v_total := public._calcular_total_sessao_mesa(p_mesa_session_id, p_store_id);
  IF v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao sem total cobravel');
  END IF;

  -- Valida a SOMA em centavos (evita erro de ponto flutuante) contra o total AUTORITATIVO --
  -- nunca confia no total que o client possa ter enviado junto, nem "ajusta" diferenca sozinho:
  -- arredondamento determinístico é responsabilidade de QUEM PROPÕE as fatias (cliente/admin),
  -- o servidor só confirma que bate exatamente.
  SELECT coalesce(sum(round((elem->>'valor')::numeric, 2)), 0) INTO v_soma
  FROM jsonb_array_elements(p_alocacoes) elem;
  IF round(v_soma, 2) <> round(v_total, 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'soma das fatias nao bate com o total da conta',
      'total', v_total, 'soma_informada', v_soma);
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_alocacoes) LOOP
    v_valor := round((v_elem->>'valor')::numeric, 2);
    IF v_valor IS NULL OR v_valor <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'fatia com valor invalido');
    END IF;
    v_metodo := nullif(btrim(v_elem->>'metodo'), '');
    INSERT INTO public.mesa_session_payment_allocations (mesa_session_id, store_id, valor, metodo, status)
    VALUES (p_mesa_session_id, p_store_id, v_valor, coalesce(v_metodo, 'a_definir'), 'pendente')
    RETURNING id INTO v_novo_id;
    v_ids := v_ids || jsonb_build_array(v_novo_id);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'total', v_total, 'alocacao_ids', v_ids);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_dividir_conta_mesa(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_dividir_conta_mesa(uuid, jsonb, uuid) TO authenticated;

-- ── admin_registrar_pagamento_alocacao: confirma 1 fatia como paga (presencial, admin-gated) ──
-- Fatia online (pix_online/cartao_online) é confirmada pelo webhook (Onda 4, ainda não
-- implementado) -- nenhuma RPC client-facing além desta escreve status='pago'.
CREATE OR REPLACE FUNCTION public.admin_registrar_pagamento_alocacao(p_alocacao_id uuid, p_metodo text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_metodo text := nullif(btrim(p_metodo), '');
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;
  IF v_metodo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forma de pagamento obrigatoria');
  END IF;

  SELECT status INTO v_status FROM public.mesa_session_payment_allocations
  WHERE id = p_alocacao_id AND store_id = p_store_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'alocacao nao encontrada');
  END IF;
  IF v_status <> 'pendente' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'alocacao ja paga');
  END IF;

  UPDATE public.mesa_session_payment_allocations
  SET status = 'pago', metodo = v_metodo, paga_em = now(), registrada_por_admin_user_id = auth.uid()
  WHERE id = p_alocacao_id AND store_id = p_store_id;

  RETURN jsonb_build_object('ok', true, 'alocacao_id', p_alocacao_id, 'metodo', v_metodo);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_registrar_pagamento_alocacao(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_pagamento_alocacao(uuid, text, uuid) TO authenticated;

-- ── admin_fechar_conta_mesa: 1 guarda nova, aditiva -- sessao SEM alocacao continua identica ──
CREATE OR REPLACE FUNCTION public.admin_fechar_conta_mesa(p_mesa_session_id uuid, p_payment_method text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_status text;
  v_pay text := nullif(btrim(p_payment_method), '');
  v_total numeric;
  v_pendentes integer;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  -- Lock da sessao -- serializa contra troca/juncao/outro fechamento concorrente (mesmo padrao
  -- das Ondas 6/9/10 da REF-MESA-02).
  SELECT status INTO v_status FROM public.mesa_sessions
  WHERE id = p_mesa_session_id AND store_id = p_store_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao nao encontrada');
  END IF;
  IF v_status <> 'aberta' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sessao ja fechada');
  END IF;

  v_total := public._calcular_total_sessao_mesa(p_mesa_session_id, p_store_id);

  -- REF-PAGAMENTO-01 · Onda 1: se a sessao tem QUALQUER divisao de conta criada, exige TODAS as
  -- fatias pagas antes de fechar -- substitui a exigencia de p_payment_method unico nesse caso.
  -- Sessao SEM nenhuma linha em mesa_session_payment_allocations (caminho de hoje, sem divisao)
  -- segue o comportamento ORIGINAL abaixo, sem nenhuma mudanca.
  SELECT count(*) INTO v_pendentes FROM public.mesa_session_payment_allocations
  WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id;
  IF v_pendentes > 0 THEN
    IF EXISTS (
      SELECT 1 FROM public.mesa_session_payment_allocations
      WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id AND status <> 'pago'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'existem fatias da divisao de conta ainda nao pagas',
        'fatias_pendentes', (SELECT count(*) FROM public.mesa_session_payment_allocations
          WHERE mesa_session_id = p_mesa_session_id AND store_id = p_store_id AND status <> 'pago'));
    END IF;
    -- Todas as fatias pagas: mesa_sessions.payment_method NAO consegue representar fielmente
    -- "N formas de pagamento diferentes" num unico campo text -- CHECK mesa_sessions_coerencia_estado
    -- (Onda 2 da REF-MESA-02) exige NOT NULL quando ha valor cobrado. Sentinela 'dividido' preserva
    -- o CHECK, e' honesto (nunca inventa UMA forma que nao existiu), e mesa_session_payment_allocations
    -- continua sendo a fonte granular real de cada metodo -- mesmo espirito de valor_cobrado_snapshot
    -- ja ser "auditoria, nunca 2a fonte de receita" (comentario original da Onda 11).
    v_pay := 'dividido';
  END IF;

  IF v_total > 0 AND v_pay IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forma de pagamento obrigatoria');
  END IF;

  UPDATE public.mesa_sessions
  SET status = 'fechada', closed_at = now(), closed_by_admin_user_id = auth.uid(),
      payment_method = v_pay, valor_cobrado_snapshot = v_total
  WHERE id = p_mesa_session_id AND store_id = p_store_id;

  RETURN jsonb_build_object('ok', true, 'mesa_session_id', p_mesa_session_id, 'total', v_total, 'payment_method', v_pay);
END;
$function$;
-- CREATE OR REPLACE preserva os grants existentes (mesma assinatura) -- confirmado pela lição já
-- documentada desde a REF-MESA-02 Onda 16 (DROP+CREATE reseta grants, CREATE OR REPLACE não).
-- Nenhum REVOKE/GRANT novo necessário aqui.

NOTIFY pgrst, 'reload schema';

COMMIT;
