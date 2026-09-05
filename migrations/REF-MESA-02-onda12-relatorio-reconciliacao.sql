-- ============================================================================
-- REF-MESA-02 · Onda 12 — Relatório/reconciliação: resolve R7 da auditoria
-- ----------------------------------------------------------------------------
-- Achado da auditoria (docs/ref/REF-MESA-02-auditoria.md §3/R7, "BI -- 2a fonte
-- de forma de pagamento"): o card "Forma de pagamento" do BI (admin_reports_
-- summary::por_pagamento) agrupava por `orders.payment_method` (por pedido).
-- Isso e' certo pra entrega/retirada (1 pedido = 1 pagamento), mas para uma
-- mesa com `mesa_sessao_habilitada`, VARIOS pedidos (bebida, prato, sobremesa)
-- compartilham UM UNICO pagamento real, registrado so' no FECHAMENTO
-- (mesa_sessions.payment_method, Onda 11) -- o payment_method de cada pedido
-- individual e' so' um valor operacional escolhido na hora do lancamento
-- (ex.: sempre "dinheiro" por padrao no formulario do garcom), nao a forma
-- real que o cliente usou pra pagar a conta inteira.
--
-- Sem esta correcao, o card atribuia (silenciosamente) receita a formas de
-- pagamento possivelmente ERRADAS pra pedidos de mesa -- exatamente o "cria
-- incentivo a somar os dois manualmente" que a auditoria alertou.
--
-- CORRECAO (admin_reports_summary, CREATE OR REPLACE -- RETURNS jsonb
-- inalterado, sem DROP necessario, mesmo padrao da Onda 6 de MESA-01):
--   - base ganha mesa_session_id + LEFT JOIN mesa_sessions (status,
--     payment_method).
--   - por_pagamento agora usa, por pedido:
--       * sem mesa_session_id -> orders.payment_method (comportamento
--         IDENTICO ao de sempre pra entrega/retirada/mesa sem sessao).
--       * mesa_session_id com sessao FECHADA -> mesa_sessions.payment_method
--         (a forma REAL, unica, da conta inteira).
--       * mesa_session_id com sessao ainda ABERTA -> bucket dedicado
--         '(conta em aberto)' -- nao adivinha, deixa visivelmente separado
--         ate' a conta fechar (nunca mais silenciosamente errado).
--
-- IMPORTANTE (reforca o que a Onda 2/11 ja documentaram): total_receita
-- continua SUM(orders.total) -- valor_cobrado_snapshot (mesa_sessions) NUNCA
-- e somado em lugar nenhum desta funcao. "Prova formal de nao-duplicacao"
-- (item pendente da auditoria) e' o proprio teste desta onda: abre sessao,
-- cria pedidos com payment_method DIFERENTES entre si, fecha com uma forma
-- especifica, confere que total_receita bate com SUM(orders.total) exato
-- (nunca dobra), e que por_pagamento atribui TUDO a forma do fechamento.
--
-- Testes: scripts/mesa-02-onda12-relatorio-reconciliacao-test.mjs (E2E).
-- Rollback: REF-MESA-02-onda12-relatorio-reconciliacao-rollback.sql (restaura
-- admin_reports_summary ao estado da Onda 6 de MESA-01, byte-a-byte).
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
    SELECT o.id, o.total, o.payment_method, o.address, o.created_at, o.tipo_pedido,
           o.mesa_session_id, ms.status AS mesa_session_status, ms.payment_method AS mesa_session_payment_method
    FROM public.orders o
    LEFT JOIN public.mesa_sessions ms ON ms.id = o.mesa_session_id AND ms.store_id = o.store_id
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
  -- REF-MESA-02 · Onda 12: resolve R7 -- pedido de mesa com sessao usa a forma REAL do fechamento
  -- (mesa_sessions.payment_method), nunca o valor operacional do pedido individual. Sessao ainda
  -- aberta vira bucket proprio '(conta em aberto)' em vez de adivinhar.
  por_pagamento AS (
    SELECT
      CASE
        WHEN mesa_session_id IS NULL THEN coalesce(payment_method, '(nao informado)')
        WHEN mesa_session_status = 'fechada' THEN coalesce(mesa_session_payment_method, '(nao informado)')
        ELSE '(conta em aberto)'
      END AS forma,
      count(*) AS pedidos, sum(total) AS receita
    FROM base
    GROUP BY 1
  ),
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
