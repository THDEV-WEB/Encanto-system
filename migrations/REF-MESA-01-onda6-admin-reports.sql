-- ============================================================================
-- REF-MESA-01 · Onda 6 — Relatórios/Métricas: elimina a regex de admin_reports_summary
-- ----------------------------------------------------------------------------
-- Achado mais grave da auditoria original (REF-MESA-01-auditoria.md §10): o card "Entrega vs.
-- retirada" do BI (AdminRelatorios.jsx) e a CTE `por_tipo` desta função classificavam pedidos por
-- `CASE WHEN address ~* 'retirada\s+na\s+loja' THEN 'retirada' ELSE 'entrega' END` — um pedido de
-- Mesa (address = "Mesa {id}") caía SILENCIOSAMENTE no `ELSE 'entrega'`, distorcendo faturamento/
-- contagem por tipo sem erro visível. Agora que orders.tipo_pedido é estruturado (Onda 1), a CTE usa
-- a coluna direto — RETURNS jsonb (não TABLE), então CREATE OR REPLACE simples basta (não precisa do
-- DROP FUNCTION que a Onda 5 precisou para admin_orders_search).
--
-- Única mudança de lógica: `base` ganha `o.tipo_pedido` no SELECT; `por_tipo` agrupa por
-- `o.tipo_pedido` em vez do CASE WHEN. Nenhuma outra CTE/agregado muda (serie/top_produtos/
-- por_pagamento continuam agnósticos a tipo, como já eram). Idempotente (CREATE OR REPLACE).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_reports_summary(p_period_start date, p_period_end date, p_store_id uuid DEFAULT default_store_id())
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
    SELECT o.id, o.total, o.payment_method, o.address, o.created_at, o.tipo_pedido
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
  -- REF-MESA-01 · Onda 6: fonte de verdade agora e' orders.tipo_pedido (estruturado, NOT NULL DEFAULT
  -- 'entrega' desde a Onda 1) -- nunca mais infere de address. Mesa aparece como 3ª fatia propria,
  -- nunca mais somada silenciosamente a 'entrega'.
  por_tipo AS (
    SELECT tipo_pedido AS tipo, count(*) AS pedidos, sum(total) AS receita
    FROM base
    GROUP BY tipo_pedido
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

NOTIFY pgrst, 'reload schema';

COMMIT;
