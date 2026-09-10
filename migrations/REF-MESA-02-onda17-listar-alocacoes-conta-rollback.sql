-- Rollback REF-MESA-02 · Onda 17 — admin_consultar_conta_mesa volta a NAO devolver 'alocacoes'.
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

NOTIFY pgrst, 'reload schema';

COMMIT;
