-- REF-BILLING-01 · Onda 3 — UI de Faturamento no Platform Console. Doc de referencia:
-- docs/ref/REF-BILLING-01-descoberta.md secao E ("nova aba 'Faturamento'") e secao I (Onda 3).
-- Depende das Ondas 1 (schema/RPCs/gate) e 2 (cron), ja ao vivo em producao.
--
-- Escopo backend desta migration (o resto da onda e frontend puro, sem migration propria):
--   1. platform_list_billing() -- RPC nova, so Platform Admin, lista TODAS as lojas com o status de
--      assinatura (LEFT JOIN -- loja sem linha em store_subscriptions aparece como 'sem_assinatura',
--      nunca some da lista nem quebra a query). Mesmo padrao exato de platform_list_tenants (RETURNS
--      TABLE, mesmo gate, mesmo estilo de ORDER BY s.nome).
--   2. get_billing_status(p_store_id) -- CREATE OR REPLACE aditivo: acrescenta o campo 'historico'
--      (ultimos 10 eventos do ledger, mais recente primeiro) ao jsonb ja retornado pela Onda 1. Nao
--      quebra nenhum chamador existente (ninguem consome esta funcao ainda no frontend -- Onda 4,
--      ainda nao autorizada, sera a primeira). Reaproveitada pelo Platform Console pra mostrar o
--      historico/auditoria (secao E) sem precisar de uma 3a RPC so pra isso.
--
-- Nenhuma das 2 funcoes muda REGRA DE NEGOCIO nenhuma -- so leitura/listagem. As 3 acoes de escrita
-- (configurar vencimento, configurar contato, marcar pago) reaproveitam as RPCs da Onda 1 sem
-- nenhuma alteracao aqui.
--
-- Companion: REF-BILLING-01-onda3-platform-console-ui-rollback.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.platform_list_billing()
 RETURNS TABLE(
   store_id uuid, slug text, nome text, status text,
   dia_vencimento smallint, proximo_vencimento date, dias_carencia smallint,
   valor_devido numeric, trial_ate date, contato_financeiro_nome text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'apenas o super admin da plataforma pode listar o faturamento das lojas'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.slug, s.nome, COALESCE(sub.status, 'sem_assinatura'),
    sub.dia_vencimento, sub.proximo_vencimento, sub.dias_carencia,
    sub.valor_devido, sub.trial_ate, sub.contato_financeiro_nome
  FROM public.stores s
  LEFT JOIN public.store_subscriptions sub ON sub.store_id = s.id
  ORDER BY s.nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.platform_list_billing() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.platform_list_billing() FROM anon;
GRANT EXECUTE ON FUNCTION public.platform_list_billing() TO authenticated;

-- ===== get_billing_status: acrescenta 'historico' (ultimos 10 eventos do ledger) =====
CREATE OR REPLACE FUNCTION public.get_billing_status(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_row       public.store_subscriptions%ROWTYPE;
  v_historico jsonb;
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.admins a WHERE a.store_id = p_store_id AND a.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'sem permissao para consultar o billing desta loja' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.store_subscriptions WHERE store_id = p_store_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tipo', e.tipo, 'payload', e.payload, 'created_at', e.created_at
  ) ORDER BY e.created_at DESC), '[]'::jsonb)
  INTO v_historico
  FROM (
    SELECT tipo, payload, created_at FROM public.store_billing_events
    WHERE store_id = p_store_id ORDER BY created_at DESC LIMIT 10
  ) e;

  IF v_row.store_id IS NULL THEN
    RETURN jsonb_build_object('store_id', p_store_id, 'status', 'sem_assinatura', 'historico', v_historico);
  END IF;

  RETURN jsonb_build_object(
    'store_id', v_row.store_id,
    'status', v_row.status,
    'dia_vencimento', v_row.dia_vencimento,
    'proximo_vencimento', v_row.proximo_vencimento,
    'dias_carencia', v_row.dias_carencia,
    'valor_devido', v_row.valor_devido,
    'trial_ate', v_row.trial_ate,
    'contato_financeiro_nome', v_row.contato_financeiro_nome,
    'contato_financeiro_email', v_row.contato_financeiro_email,
    'contato_financeiro_whatsapp', v_row.contato_financeiro_whatsapp,
    'historico', v_historico
  );
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
