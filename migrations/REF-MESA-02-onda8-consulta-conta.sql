-- ============================================================================
-- REF-MESA-02 · Onda 8 — Consulta da conta (total corrente da mesa)
-- ----------------------------------------------------------------------------
-- Primeira RPC de LEITURA sobre mesa_sessions/mesa_session_mesas (schema
-- criado na Onda 2, sem nenhum consumidor ate agora alem de create_order()).
-- Objetivo: o garcom/admin conseguir ver, a qualquer momento, o que ja foi
-- pedido numa mesa com sessao aberta e o total corrente -- sem fechar nada,
-- sem side effect algum (STABLE, somente leitura).
--
-- admin_consultar_conta_mesa(p_mesa_identificador, p_store_id) -- SECURITY
-- DEFINER, is_admin_of(p_store_id) + WHERE store_id explicito em toda tabela
-- tocada (mesmo padrao corrigido nas Ondas 2/3/4 apos o veredito adversarial
-- da auditoria -- nunca confiar so no papel quando o recurso e' buscado por
-- um identificador que o client controla).
--
-- Resultado (jsonb, mesmo estilo de admin_criar_mesa/resolver_mesa_por_token):
--   {ok:false, error:'sem permissao'|'mesa nao encontrada'}
--   {ok:true, aberta:false, mesas:[], pedidos:[], total:0}          -- mesa sem sessao aberta agora
--   {ok:true, aberta:true, sessao_id, origem_abertura, opened_at,
--    mesas:[identificadores...],                                    -- suporta juncao (Onda 10):
--                                                                    -- mais de 1 identificador na
--                                                                    -- MESMA sessao, sem mudar forma
--    pedidos:[{id,created_at,status,total,itens:[{nome_produto,
--              quantity,preco_unitario,adicionais}]}],
--    total}                                                         -- SUM(orders.total), EXCLUINDO
--                                                                    -- status='cancelado' (mesmo
--                                                                    -- criterio ja usado no BI --
--                                                                    -- REF-DASHBOARD-01, "cancelados
--                                                                    -- excluidos") -- pedidos
--                                                                    -- cancelados continuam visiveis
--                                                                    -- na lista (transparencia), so
--                                                                    -- nao entram na soma cobravel.
--
-- Nao toca create_order()/admin_orders_search() nem nenhuma tabela existente
-- -- so leitura nova sobre schema ja existente. Zero mudanca de comportamento
-- de escrita.
--
-- Testes: scripts/mesa-02-onda8-consulta-conta-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda8-consulta-conta-rollback.sql (DROP FUNCTION,
-- aditiva pura -- nenhuma funcao existente foi alterada).
-- ============================================================================

BEGIN;

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
  v_total numeric;
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

  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total', o.total,
      'itens', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'nome_produto', oi.nome_produto, 'quantity', oi.quantity,
                  'preco_unitario', oi.preco_unitario, 'adicionais', oi.adicionais
                ) ORDER BY oi.id), '[]'::jsonb)
        FROM public.order_items oi WHERE oi.order_id = o.id AND oi.store_id = p_store_id
      )
    ) ORDER BY o.created_at), '[]'::jsonb),
    coalesce(sum(o.total) FILTER (WHERE o.status <> 'cancelado'), 0)
  INTO v_pedidos, v_total
  FROM public.orders o
  WHERE o.mesa_session_id = v_session_id AND o.store_id = p_store_id;

  RETURN jsonb_build_object(
    'ok', true, 'aberta', true, 'sessao_id', v_session_id,
    'origem_abertura', v_origem_abertura, 'opened_at', v_opened_at,
    'mesas', v_mesas, 'pedidos', v_pedidos, 'total', v_total
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_consultar_conta_mesa(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consultar_conta_mesa(text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
