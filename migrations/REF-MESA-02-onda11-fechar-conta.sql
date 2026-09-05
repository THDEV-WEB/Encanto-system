-- ============================================================================
-- REF-MESA-02 · Onda 11 — Fechamento da conta
-- ----------------------------------------------------------------------------
-- Encerra uma sessao aberta (cliente pagou e foi embora) -- grava forma de
-- pagamento e valor cobrado (snapshot de auditoria), libera TODAS as mesas
-- fisicas associadas (inclusive juntadas na Onda 10 e a fechada-por-troca na
-- Onda 9), e a sessao vira imutavel (trigger _mesa_sessions_no_reopen da
-- Onda 2 ja bloqueia qualquer alteracao depois).
--
-- admin_fechar_conta_mesa(p_mesa_session_id, p_payment_method, p_store_id) --
-- SECURITY DEFINER, is_admin_of(p_store_id) + WHERE store_id explicito. Lock
-- FOR UPDATE na sessao (mesmo padrao das Ondas 6/9/10).
--
-- Total calculado EXATAMENTE como admin_consultar_conta_mesa (Onda 8):
-- SUM(orders.total) WHERE mesa_session_id=... AND status<>'cancelado' --
-- extraido pra funcao interna _calcular_total_sessao_mesa() e reaproveitado
-- nas 2 RPCs, evita duplicar a logica.
--
-- p_payment_method obrigatorio (nao vazio) SE o total > 0; pode ser NULL se
-- o total for 0 (sessao sem consumo real cobravel) -- mesma regra que a
-- CHECK mesa_sessions_coerencia_estado (Onda 2) ja impoe:
-- valor_cobrado_snapshot = 0 OR payment_method IS NOT NULL. Nao valida um
-- enum fechado de formas de pagamento -- mesmo padrao de create_order()
-- (so' checa nao-vazio), o frontend e' quem oferece as opcoes conhecidas
-- (dinheiro/pix/cartao_debito/cartao_credito, mesmas 4 de
-- NovoPedidoMesaModal.jsx).
--
-- O UPDATE de mesa_sessions.status ('aberta' -> 'fechada') dispara, POR
-- DESIGN, a trigger trg_mesa_sessions_sync_child_status ja existente desde a
-- Onda 2 -- ela sincroniza TODAS as linhas de mesa_session_mesas daquela
-- sessao pra status_sessao='fechada' automaticamente (inclusive as que a
-- Onda 9 ja tinha fechado manualmente por troca -- UPDATE idempotente, sem
-- problema). Por isso esta RPC NAO toca mesa_session_mesas nem public.mesas
-- diretamente -- "ocupada" ja e' derivado ao vivo, libera sozinho.
--
-- ATENCAO (ja documentado na Onda 2, reforcado aqui): valor_cobrado_snapshot
-- e' auditoria do fechamento, NUNCA uma segunda fonte de receita agregavel
-- (secao 3/R7 da auditoria) -- nenhum relatorio deve somar essa coluna,
-- SUM(orders.total) continua sendo a UNICA fonte de verdade de faturamento.
--
-- Testes: scripts/mesa-02-onda11-fechar-conta-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda11-fechar-conta-rollback.sql (DROP FUNCTION x2,
-- aditiva pura -- nenhuma funcao existente alterada).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._calcular_total_sessao_mesa(p_mesa_session_id uuid, p_store_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelado'), 0)
  FROM public.orders o
  WHERE o.mesa_session_id = p_mesa_session_id AND o.store_id = p_store_id;
$function$;
REVOKE ALL ON FUNCTION public._calcular_total_sessao_mesa(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- admin_consultar_conta_mesa (Onda 8): passa a reaproveitar _calcular_total_sessao_mesa em vez de
-- duplicar o mesmo SUM/FILTER inline -- CREATE OR REPLACE simples, mesma assinatura/retorno, sem
-- mudanca de comportamento (o calculo e' identico, so deixou de estar duplicado em 2 lugares).
CREATE OR REPLACE FUNCTION public.admin_consultar_conta_mesa(p_mesa_identificador text, p_store_id uuid DEFAULT default_store_id())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_identificador text := nullif(btrim(p_mesa_identificador), '');
  v_session_id uuid;
  v_origem_abertura text;
  v_opened_at timestamptz;
  v_mesas jsonb;
  v_pedidos jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  IF v_identificador IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.mesas WHERE store_id = p_store_id AND identificador = v_identificador)
  THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;

  SELECT msm.mesa_session_id INTO v_session_id
  FROM public.mesa_session_mesas msm
  WHERE msm.store_id = p_store_id AND msm.mesa_identificador = v_identificador AND msm.status_sessao = 'aberta'
  LIMIT 1;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'aberta', false, 'mesas', '[]'::jsonb, 'pedidos', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT ms.origem_abertura, ms.opened_at INTO v_origem_abertura, v_opened_at
  FROM public.mesa_sessions ms
  WHERE ms.id = v_session_id AND ms.store_id = p_store_id;

  SELECT coalesce(jsonb_agg(DISTINCT msm2.mesa_identificador), '[]'::jsonb) INTO v_mesas
  FROM public.mesa_session_mesas msm2
  WHERE msm2.mesa_session_id = v_session_id AND msm2.store_id = p_store_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total', o.total,
      'itens', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'nome_produto', oi.nome_produto, 'quantity', oi.quantity,
                  'preco_unitario', oi.preco_unitario, 'adicionais', oi.adicionais
                ) ORDER BY oi.id), '[]'::jsonb)
        FROM public.order_items oi WHERE oi.order_id = o.id AND oi.store_id = p_store_id
      )
    ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_pedidos
  FROM public.orders o
  WHERE o.mesa_session_id = v_session_id AND o.store_id = p_store_id;

  RETURN jsonb_build_object(
    'ok', true, 'aberta', true, 'sessao_id', v_session_id,
    'origem_abertura', v_origem_abertura, 'opened_at', v_opened_at,
    'mesas', v_mesas, 'pedidos', v_pedidos, 'total', public._calcular_total_sessao_mesa(v_session_id, p_store_id)
  );
END;
$function$;

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
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sem permissao');
  END IF;

  -- Lock da sessao -- serializa contra troca/juncao/outro fechamento concorrente (mesmo padrao
  -- das Ondas 6/9/10).
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
REVOKE ALL ON FUNCTION public.admin_fechar_conta_mesa(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_fechar_conta_mesa(uuid, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
