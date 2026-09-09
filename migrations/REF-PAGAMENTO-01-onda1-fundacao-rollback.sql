-- ============================================================================
-- REF-PAGAMENTO-01 · Onda 1 — ROLLBACK
-- ----------------------------------------------------------------------------
-- Restaura admin_fechar_conta_mesa ao texto EXATO da REF-MESA-02-onda11 (fiel,
-- não só funcionalmente equivalente -- lição do INCIDENTE-01 sobre hash de
-- pg_get_functiondef ser sensível a comentário/formatação). Remove as 2 RPCs
-- novas, a coluna orders.payment_status, e as 2 tabelas novas.
-- ============================================================================

BEGIN;

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

DROP FUNCTION IF EXISTS public.admin_registrar_pagamento_alocacao(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.admin_dividir_conta_mesa(uuid, jsonb, uuid);

ALTER TABLE public.orders DROP COLUMN IF EXISTS payment_status;

DROP TABLE IF EXISTS public.mesa_session_payment_allocations;
DROP TABLE IF EXISTS public.payment_intents;

NOTIFY pgrst, 'reload schema';

COMMIT;
