-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- REF-MESA-02 · Onda 18 — cliente passa a poder VER (somente leitura) a conta acumulada da própria
-- mesa, quando chegou pelo QR real. Achado do dono: hoje o cliente pede, mas nunca sabe quanto já
-- gastou/o que já foi pedido na sessão -- só o garçom vê isso (admin_consultar_conta_mesa, is_admin_of).
--
-- ESCOPO EXPLICITAMENTE DECIDIDO (dono, 2026-09-11): SÓ LEITURA. Pagamento/divisão de conta pelo
-- próprio cliente fica de fora -- fechar/dividir continua 100% com o garçom (admin_*). Esta RPC nunca
-- devolve 'alocacoes' (divisão de conta), nunca aceita nenhuma mutação.
--
-- IDENTIDADE/SEGURANÇA: mesmo padrão já em produção de resolver_mesa_por_token (REF-MESA-02 · Onda 5,
-- "QR protegido") -- resolve a mesa/sessão SOMENTE pelo qr_token opaco (uuid), NUNCA por
-- mesa_identificador (número digitado é adivinhável/enumerável, o próprio motivo da Onda 5 ter existido
-- -- reabrir esse buraco aqui seria regressão do mesmo achado já fechado). SECURITY DEFINER, publica
-- (anon/authenticated), rate limited (mesmo padrao de todas as RPCs publicas desta REF).
--
-- Dados devolvidos: só o que pertence à SESSÃO ABERTA daquela mesa -- pedidos (itens/qty/preço/status)
-- e total, mesmo formato de admin_consultar_conta_mesa MENOS 'alocacoes' (fora de escopo) e MENOS
-- qualquer dado de outro cliente que não seja o pedido em si (nomes/telefones nunca aparecem aqui --
-- a conta é da MESA, não de uma pessoa específica dentro dela).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.consultar_minha_conta_mesa(p_qr_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_mesa RECORD;
  v_session_id uuid;
  v_pedidos jsonb;
BEGIN
  IF NOT public._rate_limit_hit('consultar_minha_conta_mesa', 60, interval '10 minutes') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'muitas tentativas, aguarde um momento');
  END IF;

  IF p_qr_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;

  SELECT m.id, m.store_id, m.identificador INTO v_mesa
  FROM public.mesas m
  JOIN public.stores s ON s.id = m.store_id AND s.status = 'ativo'
  WHERE m.qr_token = p_qr_token;

  IF v_mesa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mesa nao encontrada');
  END IF;

  SELECT msm.mesa_session_id INTO v_session_id
  FROM public.mesa_session_mesas msm
  WHERE msm.store_id = v_mesa.store_id AND msm.mesa_identificador = v_mesa.identificador AND msm.status_sessao = 'aberta'
  LIMIT 1;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'aberta', false, 'mesa_identificador', v_mesa.identificador, 'pedidos', '[]'::jsonb, 'total', 0);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'created_at', o.created_at, 'status', o.status, 'total', o.total,
      'itens', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'nome_produto', oi.nome_produto, 'quantity', oi.quantity,
                  'preco_unitario', oi.preco_unitario, 'adicionais', oi.adicionais
                ) ORDER BY oi.id), '[]'::jsonb)
        FROM public.order_items oi WHERE oi.order_id = o.id AND oi.store_id = v_mesa.store_id
      )
    ) ORDER BY o.created_at), '[]'::jsonb)
  INTO v_pedidos
  FROM public.orders o
  WHERE o.mesa_session_id = v_session_id AND o.store_id = v_mesa.store_id;

  RETURN jsonb_build_object(
    'ok', true, 'aberta', true, 'mesa_identificador', v_mesa.identificador,
    'pedidos', v_pedidos, 'total', public._calcular_total_sessao_mesa(v_session_id, v_mesa.store_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.consultar_minha_conta_mesa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_minha_conta_mesa(uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
