-- REF-DASHBOARD-01 — BI/relatorios reais no Admin (fatura por dia, top produtos, forma de pagamento,
-- entrega vs retirada), por periodo escolhido pelo admin. Multi-tenant desde o dia 1 (pos REF-SAAS-01):
-- p_store_id com is_admin_of(), mesmo padrao de admin_orders_stats/orders_health.
--
-- Decisao de escopo (confirmada com o dono, 2026-08-10): pedidos CANCELADOS ficam FORA de toda soma de
-- receita/quantidade dos relatorios (diferente de admin_orders_stats/orders_health, que somam tudo —
-- aqueles sao "snapshot operacional de hoje", este e "BI de negocio", numeros propositalmente diferentes).
--
-- "entrega vs retirada" nao e uma coluna — e um classificador de texto sobre orders.address, MESMA
-- regra de src/components/admin/comanda/comandaModel.js::RE_RETIRADA (/retirada\s+na\s+loja/i). Mantida
-- inline (nao virou funcao SECURITY DEFINER dedicada porque so este relatorio precisa dela em SQL) —
-- se RE_RETIRADA mudar no JS, replicar aqui tambem.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reports_summary(
  p_period_start date,
  p_period_end date,
  p_store_id uuid DEFAULT public.default_store_id()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_of(p_store_id) THEN
    RAISE EXCEPTION 'apenas administradores desta loja podem ver relatorios' USING ERRCODE = '42501';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_start > p_period_end THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22007';
  END IF;

  WITH base AS (
    SELECT o.id, o.total, o.payment_method, o.address, o.created_at
    FROM public.orders o
    WHERE o.store_id = p_store_id
      AND o.status <> 'cancelado'
      AND public.dia_loja(o.created_at) BETWEEN p_period_start AND p_period_end
  ),
  serie AS (
    SELECT d::date AS dia,
           coalesce((SELECT count(*) FROM base b WHERE public.dia_loja(b.created_at) = d::date), 0) AS pedidos,
           coalesce((SELECT sum(b.total) FROM base b WHERE public.dia_loja(b.created_at) = d::date), 0) AS faturamento
    FROM generate_series(p_period_start, p_period_end, interval '1 day') d
  ),
  top_produtos AS (
    SELECT oi.nome_produto AS nome,
           sum(oi.quantity) AS quantidade,
           sum(oi.quantity * oi.preco_unitario) AS receita
    FROM public.order_items oi
    JOIN base b ON b.id = oi.order_id
    GROUP BY oi.nome_produto
    ORDER BY receita DESC
    LIMIT 10
  ),
  por_pagamento AS (
    SELECT coalesce(payment_method, '(nao informado)') AS forma, count(*) AS pedidos, sum(total) AS receita
    FROM base
    GROUP BY coalesce(payment_method, '(nao informado)')
  ),
  por_tipo AS (
    SELECT CASE WHEN address ~* 'retirada\s+na\s+loja' THEN 'retirada' ELSE 'entrega' END AS tipo,
           count(*) AS pedidos, sum(total) AS receita
    FROM base
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'periodo_inicio', p_period_start,
    'periodo_fim', p_period_end,
    'total_pedidos', (SELECT count(*) FROM base),
    'total_receita', (SELECT coalesce(sum(total), 0) FROM base),
    'serie_dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', to_char(dia,'DD/MM'), 'pedidos', pedidos, 'faturamento', faturamento) ORDER BY dia), '[]'::jsonb) FROM serie),
    'top_produtos', (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quantidade', quantidade, 'receita', receita)), '[]'::jsonb) FROM top_produtos),
    'por_pagamento', (SELECT coalesce(jsonb_agg(jsonb_build_object('forma', forma, 'pedidos', pedidos, 'receita', receita) ORDER BY receita DESC), '[]'::jsonb) FROM por_pagamento),
    'por_tipo', (SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'pedidos', pedidos, 'receita', receita) ORDER BY tipo), '[]'::jsonb) FROM por_tipo)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- Sem REVOKE/GRANT explicito de proposito: mesmo padrao de admin_orders_stats/orders_health (grants
-- default do projeto p/ PUBLIC/anon/authenticated/postgres/service_role) — a autorizacao real e o
-- is_admin_of(p_store_id) no corpo da funcao, nao o nivel de GRANT do PostgREST.

COMMIT;

NOTIFY pgrst, 'reload schema';
